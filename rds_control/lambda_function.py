import base64
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs


# ============================================================
# RDS Control Lambda エントリポイント
# ============================================================
# stella-aynu-rds-control 用のLambda。VPC外で動作させ、RDS Data Planeではなく
# RDS/S3 Control Plane APIだけを呼ぶ。既存の stella-aynu-api はDB編集APIに専念する。
logger = logging.getLogger()
logger.setLevel(logging.INFO)

BASE_RESPONSE_HEADERS = {
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
}

DEFAULT_RDS_ACTIVITY_KEY = "state/rds-activity.json"
DEFAULT_RDS_IDLE_MINUTES = 30
DEFAULT_RDS_MAX_RUNNING_HOURS = 6


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
    raw = os.environ["AYNU_ALLOWED_ORIGINS"]
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
    """API Gateway が期待する Lambda proxy integration 形式のレスポンスを作る。"""
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
    """RDS制御API用の認可を行う。API GatewayのCognito authorizer設定が前提。"""
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
    """heartbeat の lastUser に保存する管理ユーザーのメールアドレスをJWT claimsから取り出す。"""
    claims = get_authorizer_claims(event)
    return str(claims.get("email") or "").strip()


def utc_now():
    """RDS稼働状態の判定に使う現在時刻をUTC aware datetimeで返す。"""
    return datetime.now(timezone.utc)


def to_utc_iso(value):
    """UTC datetimeを state JSON 用のISO 8601文字列へ変換する。"""
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_utc_iso(value):
    """state JSON のISO 8601文字列をUTC aware datetimeへ変換する。"""
    if not value:
        return None

    try:
        text = str(value).strip()
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        parsed = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        logger.warning("Invalid RDS activity timestamp: %s", value)
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def get_positive_number_env(name, default_value):
    """正の数値環境変数を取得する。不正値は安全側で既定値を使う。"""
    raw = os.environ.get(name, "")
    if not raw:
        return default_value

    try:
        value = float(raw)
    except ValueError:
        logger.warning("Invalid numeric environment variable %s=%s", name, raw)
        return default_value

    return value if value > 0 else default_value


def get_rds_instance_id():
    """操作対象のRDS DBインスタンスIDを環境変数から取得する。"""
    instance_id = os.environ.get("RDS_INSTANCE_ID", "").strip()
    if not instance_id:
        raise RuntimeError("RDS_INSTANCE_ID が設定されていません")
    return instance_id


def get_rds_activity_location():
    """RDS利用状況を保存するS3バケットとキーを取得する。"""
    bucket = (
        os.environ.get("RDS_ACTIVITY_BUCKET", "").strip()
        or os.environ.get("AYNU_PUBLIC_DATA_BUCKET", "").strip()
    )
    if not bucket:
        raise RuntimeError("RDS_ACTIVITY_BUCKET または AYNU_PUBLIC_DATA_BUCKET が設定されていません")

    key = os.environ.get("RDS_ACTIVITY_KEY", DEFAULT_RDS_ACTIVITY_KEY).strip().lstrip("/")
    if not key:
        raise RuntimeError("RDS_ACTIVITY_KEY が空です")
    return bucket, key


def get_rds_client():
    """RDS APIクライアントを作成する。"""
    import boto3

    return boto3.client("rds")


def get_s3_client():
    """S3 APIクライアントを作成する。"""
    import boto3

    return boto3.client("s3")


def get_rds_status():
    """RDS DBインスタンスの現在状態を返す。"""
    result = get_rds_client().describe_db_instances(
        DBInstanceIdentifier=get_rds_instance_id(),
    )
    instances = result.get("DBInstances") or []
    if not instances:
        raise RuntimeError("RDS DBインスタンスが見つかりません")
    return str(instances[0].get("DBInstanceStatus") or "unknown")


def normalize_activity_timestamp(value):
    """state JSON内の時刻をUTC ISO文字列へ正規化する。"""
    parsed = parse_utc_iso(value)
    return to_utc_iso(parsed) if parsed else None


def read_activity_state():
    """S3上のRDS利用状況JSONを読み取る。未作成の場合は空dictを返す。"""
    bucket, key = get_rds_activity_location()
    try:
        result = get_s3_client().get_object(Bucket=bucket, Key=key)
    except Exception as exc:
        error = getattr(exc, "response", {}).get("Error", {})
        if str(error.get("Code")) in {"NoSuchKey", "404", "NotFound"}:
            return {}
        raise

    raw = result["Body"].read().decode("utf-8")
    if not raw.strip():
        return {}

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Invalid RDS activity JSON: s3://%s/%s", bucket, key)
        return {}

    return data if isinstance(data, dict) else {}


def write_activity_state(state):
    """RDS利用状況JSONをS3へ保存する。"""
    bucket, key = get_rds_activity_location()
    encoded = json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    get_s3_client().put_object(
        Bucket=bucket,
        Key=key,
        Body=encoded,
        ContentType="application/json; charset=utf-8",
        CacheControl="no-store",
    )
    return {"bucket": bucket, "key": key}


def start_rds_if_stopped():
    """RDSが停止中なら起動要求を送り、startedAtをS3 stateへ記録する。"""
    status = get_rds_status()
    if status != "stopped":
        result = build_rds_status_response(status)
        result["action"] = "noop"
        return result

    get_rds_client().start_db_instance(DBInstanceIdentifier=get_rds_instance_id())

    activity = read_activity_state()
    started_at = to_utc_iso(utc_now())
    activity["startedAt"] = started_at
    write_activity_state(activity)

    result = build_rds_status_response("starting", activity=activity)
    result["previousStatus"] = status
    result["action"] = "start-requested"
    return result


def record_heartbeat(user_email=""):
    """RDSが利用可能な場合だけ編集画面からのheartbeatをS3 stateへ記録する。"""
    status = get_rds_status()
    if status != "available":
        result = build_rds_status_response(status)
        result["message"] = "heartbeat skipped"
        result["action"] = "noop"
        return result

    activity = read_activity_state()
    last_active_at = to_utc_iso(utc_now())
    activity["lastActiveAt"] = last_active_at
    if user_email:
        activity["lastUser"] = user_email
    write_activity_state(activity)

    result = build_rds_status_response(status, activity=activity)
    result["message"] = "heartbeat recorded"
    result["action"] = "heartbeat-recorded"
    return result


def calculate_auto_stop_at(activity, now, status):
    """RDSが available の場合の自動停止判定時刻を返す。"""
    if status != "available":
        return None

    last_active_value = activity.get("lastActiveAt") if isinstance(activity, dict) else None
    started_value = activity.get("startedAt") if isinstance(activity, dict) else None
    if not activity or (not last_active_value and not started_value):
        return now

    deadlines = []
    idle_minutes = get_positive_number_env("RDS_IDLE_MINUTES", DEFAULT_RDS_IDLE_MINUTES)
    max_running_hours = get_positive_number_env(
        "RDS_MAX_RUNNING_HOURS",
        DEFAULT_RDS_MAX_RUNNING_HOURS,
    )

    last_active_at = parse_utc_iso(last_active_value)
    if last_active_at:
        deadlines.append(last_active_at + timedelta(minutes=idle_minutes))

    started_at = parse_utc_iso(started_value)
    if started_at:
        deadlines.append(started_at + timedelta(hours=max_running_hours))

    return min(deadlines) if deadlines else None


def build_rds_status_response(status, activity=None, now=None):
    """RDS状態とactivity stateからフロントエンド用の状態レスポンスを作る。"""
    current_activity = read_activity_state() if activity is None else activity
    if not isinstance(current_activity, dict):
        current_activity = {}
    checked_at = now or utc_now()
    auto_stop_at = calculate_auto_stop_at(current_activity, checked_at, status)

    return {
        "status": status,
        "startedAt": normalize_activity_timestamp(current_activity.get("startedAt")),
        "lastActiveAt": normalize_activity_timestamp(current_activity.get("lastActiveAt")),
        "autoStopAt": to_utc_iso(auto_stop_at) if auto_stop_at else None,
    }


def get_auto_stop_reasons(activity, now):
    """S3 stateと環境変数からRDS停止理由を判定する。"""
    last_active_value = activity.get("lastActiveAt") if isinstance(activity, dict) else None
    started_value = activity.get("startedAt") if isinstance(activity, dict) else None
    if not activity or (not last_active_value and not started_value):
        return ["no-activity-state"]

    reasons = []
    idle_minutes = get_positive_number_env("RDS_IDLE_MINUTES", DEFAULT_RDS_IDLE_MINUTES)
    max_running_hours = get_positive_number_env(
        "RDS_MAX_RUNNING_HOURS",
        DEFAULT_RDS_MAX_RUNNING_HOURS,
    )

    last_active_at = parse_utc_iso(last_active_value)
    if last_active_at and now - last_active_at >= timedelta(minutes=idle_minutes):
        reasons.append("idle-timeout")

    started_at = parse_utc_iso(started_value)
    if started_at and now - started_at >= timedelta(hours=max_running_hours):
        reasons.append("max-running-time")

    return reasons


def auto_stop_rds_handler(event, context):
    """EventBridge Schedulerから定期実行し、未利用または長時間起動中のRDSを停止する。"""
    checked_at = utc_now()
    status = get_rds_status()
    result = {
        "checkedAt": to_utc_iso(checked_at),
        "status": status,
        "stopped": False,
        "reasons": [],
    }

    if status != "available":
        logger.info("Skip RDS auto stop because status is %s", status)
        return result

    activity = read_activity_state()
    reasons = get_auto_stop_reasons(activity, checked_at)
    result["reasons"] = reasons

    if not reasons:
        logger.info("Skip RDS auto stop because activity is still within thresholds")
        return result

    get_rds_client().stop_db_instance(DBInstanceIdentifier=get_rds_instance_id())
    result["stopped"] = True
    logger.info("Requested RDS stop: reasons=%s", ",".join(reasons))
    return result


def is_auto_stop_event(event):
    """handlerへEventBridgeを直接接続した場合に自動停止イベントを判定する。"""
    if not isinstance(event, dict):
        return False
    if event.get("action") == "auto-stop-rds":
        return True
    if event.get("source") not in {"aws.events", "aws.scheduler"}:
        return False
    return not (event.get("httpMethod") or event.get("rawPath") or event.get("path"))


def handle_api_request(event, method, path):
    """認証済みユーザー向けのRDS制御APIを処理する。"""
    auth_error = authorize_admin(event)
    if auth_error:
        return auth_error

    control_path = path.rstrip("/")

    try:
        if control_path.endswith("/api/admin/rds-status"):
            if method != "GET":
                return response(405, {"error": "Method not allowed"}, event)
            return response(200, build_rds_status_response(get_rds_status()), event)

        if control_path.endswith("/api/admin/rds-start"):
            if method != "POST":
                return response(405, {"error": "Method not allowed"}, event)
            return response(202, start_rds_if_stopped(), event)

        if control_path.endswith("/api/admin/heartbeat"):
            if method != "POST":
                return response(405, {"error": "Method not allowed"}, event)
            get_json_body(event)
            return response(200, record_heartbeat(get_admin_account(event)), event)

        return response(404, {"error": "Not found"}, event)
    except ValueError as exc:
        return response(400, {"error": str(exc)}, event)
    except Exception:
        logger.exception("Unhandled exception")
        return response(500, {"error": "Internal server error"}, event)


def lambda_handler(event, context):
    """RDS制御Lambdaのメイン処理。API GatewayとEventBridge Schedulerの両方に対応する。"""
    event = event or {}

    if is_auto_stop_event(event):
        return auto_stop_rds_handler(event, context)

    method = get_method(event)
    path = get_path(event)

    if method == "OPTIONS":
        return response(200, {}, event)

    return handle_api_request(event, method, path)
