import base64
import json
import logging
import os
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote

import psycopg2

from db import (
    build_aynu_data,
    create_admin_table_row,
    delete_admin_table_row,
    get_admin_lookup_options,
    get_admin_table_row,
    get_admin_tables_metadata,
    list_admin_table_rows,
    update_admin_table_row,
)


# ============================================================
# API Gateway / Lambda エントリポイント
# ============================================================
# 認証済みユーザー向けの管理APIだけを処理する。
# 公開データは管理APIからエクスポートしたJSONをS3とCloudFrontで配信する。
# REST API形式(httpMethod/path)とHTTP API v2形式(requestContext.http/rawPath)の両方に対応し、
# API Gateway の構成が変わっても同じ handler を使えるようにしている。
logger = logging.getLogger()
logger.setLevel(logging.INFO)

DEFAULT_ALLOWED_ORIGINS = "https://main.d3nyn80kgira6c.amplifyapp.com"
BASE_RESPONSE_HEADERS = {
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
}


def get_request_header(event, header_name):
    """API Gatewayのヘッダー名の大文字小文字差を吸収して値を取り出す。"""
    target = header_name.lower()
    headers = (event or {}).get("headers") or {}
    for key, value in headers.items():
        if str(key).lower() == target:
            return str(value or "").strip()
    return ""


def get_allowed_origins():
    """CORSを許可する完全一致Originの集合を環境変数から作る。"""
    raw = os.environ.get("AYNU_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    return {origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()}


def build_response_headers(event=None):
    """共通レスポンスヘッダーと、許可済みOriginのCORSヘッダーを組み立てる。"""
    headers = dict(BASE_RESPONSE_HEADERS)
    origin = get_request_header(event, "origin").rstrip("/")
    if origin and origin in get_allowed_origins():
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return headers


def response(status_code, body, event=None):
    """API Gateway が期待する Lambda proxy integration 形式のレスポンスを作る。

    ensure_ascii=False にして、日本語の星文化名・説明をエスケープせず返す。
    ブラウザから直接呼ばれるAPIなので、許可済みOriginにだけCORSヘッダーを付ける。
    """
    return {
        "statusCode": status_code,
        "headers": build_response_headers(event),
        "body": json.dumps(body, ensure_ascii=False),
    }


def get_method(event):
    """API Gateway のイベント形式差分を吸収してHTTPメソッドを取り出す。"""
    return (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "GET"
    ).upper()


def get_path(event):
    """API Gateway のイベント形式差分を吸収してリクエストパスを取り出す。"""
    return event.get("rawPath") or event.get("path") or "/"


def get_query_params(event):
    """API Gateway v1/v2の差を吸収してクエリ文字列をdictで返す。"""
    params = event.get("queryStringParameters")
    if params:
        return {key: value for key, value in params.items() if value is not None}

    raw = event.get("rawQueryString") or ""
    if not raw:
        return {}

    parsed = parse_qs(raw, keep_blank_values=True)
    return {key: values[-1] if values else "" for key, values in parsed.items()}


def get_json_body(event):
    """JSONリクエストボディをdictへ変換する。空ボディは空dictとして扱う。"""
    body = event.get("body")
    if not body:
        return {}

    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")

    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("リクエストボディはJSONで送信してください") from exc


def parse_admin_table_path(path):
    """管理APIのパスからテーブル名と任意の主キー値を取り出す。"""
    marker = "/api/admin/tables"
    marker_pos = path.find(marker)
    if marker_pos < 0:
        return None, None

    tail = path[marker_pos + len(marker):].lstrip("/")
    if not tail:
        return "", None

    parts = tail.split("/", 1)
    table_name = unquote(parts[0])
    primary_key_value = unquote(parts[1]) if len(parts) > 1 else None
    return table_name, primary_key_value


def is_admin_path(path):
    """このLambdaで扱う管理APIパスかどうかを判定する。"""
    return "/api/admin/" in path


def get_authorizer_claims(event):
    """Cognito authorizer のJWT claimsをAPI Gatewayのイベントから取り出す。"""
    authorizer = event.get("requestContext", {}).get("authorizer", {}) or {}

    jwt_claims = authorizer.get("jwt", {}).get("claims")
    if jwt_claims:
        return jwt_claims

    rest_claims = authorizer.get("claims")
    if rest_claims:
        return rest_claims

    lambda_claims = authorizer.get("lambda", {}).get("claims")
    if lambda_claims:
        return lambda_claims

    return {}


def split_claim_values(value):
    """Cognito groups claim の表記揺れを吸収して集合化する。"""
    if value is None:
        return set()
    if isinstance(value, (list, tuple, set)):
        return {str(item).strip() for item in value if str(item).strip()}

    text = str(value).strip()
    if not text:
        return set()

    # HTTP APIでは "admin,editor"、検証環境では "['admin', 'editor']" のような形も来ることがある。
    stripped = text.strip("[]")
    return {
        part.strip().strip("'\"")
        for part in stripped.replace(" ", ",").split(",")
        if part.strip().strip("'\"")
    }


def get_configured_groups(env_name, default_groups):
    """管理API用グループ設定を集合化する。明示的な空設定は許可なしとして扱う。"""
    raw = os.environ.get(env_name, default_groups)
    return {group.strip() for group in raw.split(",") if group.strip()}


def authorize_admin(
    event,
    *,
    groups_env="AYNU_ADMIN_GROUPS",
    default_groups="admin,editor",
    denied_message="編集権限がありません",
):
    """管理API用の認可を行う。API GatewayのCognito authorizer設定が前提。"""
    claims = get_authorizer_claims(event)
    if not claims:
        return response(401, {"error": "認証が必要です"}, event)

    allowed_groups = get_configured_groups(groups_env, default_groups)
    if not allowed_groups:
        return response(503, {"error": "管理APIの認可設定が完了していません"}, event)

    user_groups = split_claim_values(claims.get("cognito:groups") or claims.get("groups"))
    if user_groups & allowed_groups:
        return None

    return response(403, {"error": denied_message}, event)


def get_admin_account(event):
    """updated_by に保存する管理ユーザーのメールアドレスをJWT claimsから取り出す。"""
    claims = get_authorizer_claims(event)
    return str(claims.get("email") or "").strip()


def export_public_json():
    """DBから公開データを生成し、静的配信用のS3オブジェクトを更新する。"""
    bucket = os.environ.get("AYNU_PUBLIC_DATA_BUCKET", "").strip()
    if not bucket:
        raise RuntimeError("AYNU_PUBLIC_DATA_BUCKET が設定されていません")

    object_key = os.environ.get("AYNU_PUBLIC_DATA_KEY", "").strip().lstrip("/")
    if not object_key:
        raise RuntimeError("AYNU_PUBLIC_DATA_KEY が空です")

    data = build_aynu_data()
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    # boto3はLambdaランタイム同梱版を使い、デプロイZIPを不要に肥大化させない。
    import boto3

    result = boto3.client("s3").put_object(
        Bucket=bucket,
        Key=object_key,
        Body=encoded,
        ContentType="application/json; charset=utf-8",
        CacheControl=os.environ.get(
            "AYNU_PUBLIC_DATA_CACHE_CONTROL",
            "public, max-age=60, must-revalidate",
        ),
    )

    return {
        "message": "公開JSONを生成しました",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "bucket": bucket,
        "key": object_key,
        "bytes": len(encoded),
        "etag": str(result.get("ETag") or "").strip('"'),
        "counts": {
            "stars": len(data.get("stars") or {}),
            "constellations": len(data.get("constellations") or []),
            "cities": len(data.get("cityMap") or {}),
        },
    }


def handle_admin_request(event, method, path):
    """認証済みユーザー向けのテーブルCRUD APIを処理する。"""
    auth_error = authorize_admin(event)
    if auth_error:
        return auth_error

    if method == "DELETE":
        delete_auth_error = authorize_admin(
            event,
            groups_env="AYNU_ADMIN_DELETE_GROUPS",
            default_groups="admin",
            denied_message="削除権限がありません",
        )
        if delete_auth_error:
            return delete_auth_error

    try:
        if path.endswith("/api/admin/export-json"):
            if method != "POST":
                return response(405, {"error": "Method not allowed"}, event)

            result = export_public_json()
            return response(200, result, event)

        if (
            path.endswith("/api/admin/options")
            or "/api/admin/options" in path
            or path.endswith("/api/admin/tables/_options")
            or "/api/admin/tables/_options" in path
        ):
            if method != "GET":
                return response(405, {"error": "Method not allowed"}, event)
            return response(200, get_admin_lookup_options(), event)

        table_name, path_primary_key = parse_admin_table_path(path)
        query = get_query_params(event)
        primary_key_value = query.get("pk") or path_primary_key

        if table_name == "" and method == "GET":
            return response(200, get_admin_tables_metadata(), event)

        if not table_name:
            return response(404, {"error": "Not found"}, event)

        if method == "GET":
            if primary_key_value:
                row = get_admin_table_row(table_name, primary_key_value)
                if row is None:
                    return response(404, {"error": "行が見つかりません"}, event)
                return response(200, {"row": row}, event)

            return response(
                200,
                list_admin_table_rows(
                    table_name,
                    query_text=query.get("q", ""),
                    limit=query.get("limit", 500),
                    offset=query.get("offset", 0),
                ),
                event,
            )

        if method in {"POST", "PUT", "PATCH"}:
            updated_by = get_admin_account(event)
            if not updated_by:
                return response(400, {"error": "ログインメールアドレスを取得できませんでした。もう一度ログインしてください。"}, event)

        if method == "POST":
            row = create_admin_table_row(
                table_name,
                get_json_body(event),
                updated_by=updated_by,
            )
            return response(
                201,
                {"row": row},
                event,
            )

        if method in {"PUT", "PATCH"}:
            if not primary_key_value:
                return response(400, {"error": "更新対象の主キーを pk クエリパラメータで指定してください"}, event)
            row = update_admin_table_row(
                table_name,
                primary_key_value,
                get_json_body(event),
                updated_by=updated_by,
            )
            if row is None:
                return response(404, {"error": "更新対象の行が見つかりません"}, event)
            return response(200, {"row": row}, event)

        if method == "DELETE":
            if not primary_key_value:
                return response(400, {"error": "削除対象の主キーを pk クエリパラメータで指定してください"}, event)
            row = delete_admin_table_row(table_name, primary_key_value)
            if row is None:
                return response(404, {"error": "削除対象の行が見つかりません"}, event)
            return response(200, {"row": row}, event)

        return response(405, {"error": "Method not allowed"}, event)
    except ValueError as exc:
        return response(400, {"error": str(exc)}, event)
    except psycopg2.IntegrityError as exc:
        return response(409, {"error": str(exc).splitlines()[0]}, event)
    except Exception:
        logger.exception("Unhandled exception")
        return response(500, {"error": "Internal server error"}, event)


def handler(event, context):
    """Lambdaのメイン処理。

    OPTIONS はCORSプリフライト用に即時成功させる。
    認証済み管理APIだけを処理し、それ以外のパスは404を返す。
    """
    method = get_method(event or {})
    path = get_path(event or {})

    if method == "OPTIONS":
        return response(200, {}, event)

    if is_admin_path(path):
        return handle_admin_request(event or {}, method, path)

    return response(404, {"error": "Not found"}, event)
