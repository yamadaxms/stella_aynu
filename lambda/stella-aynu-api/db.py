import json
import os
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from urllib.parse import urlparse

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor

from admin_schema import ADMIN_TABLES, ADMIN_LOOKUP_TABLES, SCHEMA_TABLES


DB_TIME_ZONE = "Asia/Tokyo"


# ============================================================
# DBデータをフロントエンド用JSONへ変換するモジュール
# ============================================================
# 管理APIのエクスポート処理がS3へ保存する stars / constellations / cityMap を、PostgreSQLの正規化テーブルから組み立てる。
# 画面側の js/main.js は旧来の静的JSONと同じ形を期待しているため、ここでDB列名やDecimal型などの差分を吸収する。
# - stars: HIP番号 -> {ra, dec}
# - constellations: 星文化名、説明、星座線、対応するアイヌ民族星文化地域
# - cityMap: 市町村 -> 気象予報区、地方区分、振興局、緯度経度、表示順、文化地域


def get_connection():
    """環境変数からPostgreSQL接続を作る。

    Lambdaデプロイ時にDB接続情報を環境変数で渡す前提にして、コードやZIP内へ認証情報を含めない。
    portだけは標準の5432を既定値にし、他の必須値は未設定ならKeyErrorで早めに失敗させる。
    """
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        options=f"-c timezone={DB_TIME_ZONE}",
    )


def query_rows(conn, query, params=None):
    """SQLを実行し、列名で参照できる辞書形式の行配列を返す。

    RealDictCursor を使うことで row["city"] のように列名で読みやすく扱い、
    SELECT列の順序変更で変換処理が壊れにくいようにする。
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query, params or ())
        return cur.fetchall()


def execute_query(conn, query, params=None):
    """結果行を返さないINSERT/UPDATE/DELETEを実行する。"""
    with conn.cursor() as cur:
        cur.execute(query, params or ())


def to_float(value):
    """DB値をJSONへ載せられる float / None に正規化する。

    psycopg2 は numeric 型を Decimal として返すが、json.dumps は Decimal を直接扱えない。
    緯度経度や赤経赤緯の欠損・不正値は None に落として、呼び出し側でフォールバックできるようにする。
    """
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_int(value):
    """DB値を表示順などに使う int / None に正規化する。"""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def to_text(value):
    """DBの文字列値を表示用JSONへ載せやすい文字列へ正規化する。"""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "、".join(text for text in (to_text(item) for item in value) if text)
    text = str(value).strip()
    if text.lower() == "[null]":
        return ""
    return text


def to_public_url(value):
    """公開APIへ返せるURLをHTTP/HTTPSに限定する。既存の不正値もここで無効化する。"""
    text = to_text(value)
    if not text:
        return ""
    parsed = urlparse(text)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return ""
    return text


def to_hip_key(value):
    """HIP番号をフロントエンドが参照する `HIP_12345` 形式へそろえる。

    DBには数値だけで入っている場合と、既に HIP_ 接頭辞付きで入っている場合がある。
    星座線定義と恒星座標辞書のキーを一致させるため、ここで表記揺れを吸収する。
    """
    if value is None:
        return None
    key = str(value).strip()
    if not key:
        return None
    return key if key.startswith("HIP_") else f"HIP_{key}"


def s_area_to_aynu_code(value):
    """DBの星文化地域を constellations[].aynu 用の値へ変換する。

    DB側では 1-5 / 地域区分Ⅰ- 地域区分Ⅴなどで地域を持つが、画面側の標準地域は
    aynu1-5 を使う。標準地域以外の値は検索画面の「その他」列へ出すため、
    捨てずに元の文字列を返す。
    """
    if value is None:
        return None
    area = str(value).strip()
    if not area:
        return None
    normalized_area = unicodedata.normalize("NFKC", area)
    if normalized_area in {"1", "2", "3", "4", "5"}:
        return f"aynu{normalized_area}"
    area_lower = normalized_area.lower()
    if area_lower.startswith("aynu"):
        return area_lower

    normalized = (
        area_lower
        .replace(" ", "")
        .replace("　", "")
        .replace("（", "")
        .replace("）", "")
        .replace("(", "")
        .replace(")", "")
        .removeprefix("地域")
        .removeprefix("区分")
    )
    roman_map = {
        "i": "aynu1",
        "ii": "aynu2",
        "iii": "aynu3",
        "iv": "aynu4",
        "v": "aynu5",
        "Ⅰ": "aynu1",
        "Ⅱ": "aynu2",
        "Ⅲ": "aynu3",
        "Ⅳ": "aynu4",
        "Ⅴ": "aynu5",
    }
    if normalized in roman_map:
        return roman_map[normalized]

    return area


def is_standard_aynu_area(value):
    """地域区分Ⅰ-Ⅴに相当する地域名かどうかを判定する。"""
    return s_area_to_aynu_code(value) in {"aynu1", "aynu2", "aynu3", "aynu4", "aynu5"}


def is_excluded_other_area(value):
    """検索画面のその他列から除外する地域名かどうかを判定する。"""
    if value is None:
        return False
    normalized = unicodedata.normalize("NFKC", str(value).strip())
    return normalized == "全域"


def aynu_codes_to_area_keys(codes):
    """aynu1-5 のコードを、UIで使う area1-5 のキーへ変換する。

    areaキーは地図画像ファイル名(img/areaN.png)や画面表示ロジックと直結している。
    同じ地域が複数行から来ても、表示用には重複しない配列として返す。
    """
    mapping = {
        "aynu1": "area1",
        "aynu2": "area2",
        "aynu3": "area3",
        "aynu4": "area4",
        "aynu5": "area5",
    }
    keys = []
    for code in codes or []:
        key = mapping.get(str(code))
        if key and key not in keys:
            keys.append(key)
    return keys


def fetch_stars(conn):
    """恒星マスタから、星座線描画に必要なHIP座標辞書を作る。

    赤経・赤緯が欠けている行はCanvasへ投影できないため除外する。
    キーは `HIP_番号` に統一し、constellation_line_list から生成する線分定義と突き合わせられるようにする。
    """
    rows = query_rows(
        conn,
        """
        SELECT hipparcos, ra, "dec"
        FROM star_master
        ORDER BY hipparcos
        """,
    )

    stars = {}
    for row in rows:
        key = to_hip_key(row["hipparcos"])
        ra = to_float(row["ra"])
        dec = to_float(row["dec"])
        if key and ra is not None and dec is not None:
            stars[key] = {"ra": ra, "dec": dec}
    return stars


def fetch_constellations(conn):
    """公開中の星文化定義を、フロントエンドのGeoJSON生成元データへ変換する。

    star_culture / constellation_list から名称・説明・ラベル位置を取得し、
    constellation_line_list で線分のHIP点列を組み立て、star_area_link で文化地域コードを付与する。
    画面側はこの構造をもとに、選択された地域だけをMultiLineStringへ変換して描画する。
    """
    culture_rows = query_rows(
        conn,
        """
        SELECT
            sc.star_culture_id,
            sc.name_ja,
            sc.name_en,
            sc.meaning,
            sc.original_name_ja,
            sc.original_name_en,
            sc.original_meaning,
            sc.constellation_key,
            sc.culture_cd,
            ccm.culture_name,
            cl.ra,
            cl."dec"
        FROM star_culture sc
        LEFT JOIN constellation_list cl
          ON cl.constellation_key = sc.constellation_key
        LEFT JOIN culture_cd_master ccm
          ON ccm.culture_cd = sc.culture_cd
        WHERE sc.is_published = true
          AND (
            sc.constellation_key IS NULL
            OR cl.is_published = true
          )
        ORDER BY sc.star_culture_id
        """,
    )
    line_rows = query_rows(
        conn,
        """
        SELECT constellation_key, line_no, point_no, hipparcos
        FROM constellation_line_list
        ORDER BY constellation_key, line_no, point_no
        """,
    )
    astro_rows = query_rows(
        conn,
        """
        SELECT
            sal.star_culture_id,
            sal.astro_id,
            am.astro_name,
            sal.memo AS link_memo,
            am.constellation,
            am.astro_cd,
            am.memo
        FROM star_astro_link sal
        LEFT JOIN astro_master am
          ON am.astro_id = sal.astro_id
        ORDER BY sal.star_culture_id, am.astro_cd NULLS LAST, am.astro_name, sal.astro_id
        """,
    )
    star_area_rows = query_rows(
        conn,
        """
        SELECT
            sal.star_culture_id,
            sal.area_id,
            al.area_name,
            sal.memo AS link_memo,
            al.memo
        FROM star_area_link sal
        LEFT JOIN area_list al
          ON al.area_id = sal.area_id
        ORDER BY
            sal.star_culture_id,
            CASE al.area_name
                WHEN '全域' THEN 0
                WHEN '地域区分Ⅰ' THEN 1
                WHEN '地域区分Ⅱ' THEN 2
                WHEN '地域区分Ⅲ' THEN 3
                WHEN '地域区分Ⅳ' THEN 4
                WHEN '地域区分Ⅴ' THEN 5
                ELSE 6
            END,
            al.area_name, sal.area_id
        """,
    )
    source_rows = query_rows(
        conn,
        """
        SELECT
            ssl.star_culture_id,
            ssl.source_id,
            sl.source_name,
            ssl.page_info,
            ssl.memo AS link_memo,
            CASE WHEN sl.detail_flg = true THEN sl.source_detail ELSE NULL END AS source_detail,
            sl.publisher,
            sl.author,
            sl.publication_date,
            sl.publication_area,
            sl.url,
            sl.memo,
            sl.source_cd
        FROM star_source_link ssl
        JOIN source_list sl
          ON sl.source_id = ssl.source_id
         AND sl.is_published = true
        ORDER BY ssl.star_culture_id, sl.source_cd NULLS LAST, sl.source_name, ssl.source_id
        """,
    )
    tradition_rows = query_rows(
        conn,
        """
        SELECT
            stl.star_culture_id,
            stl.tradition_id,
            tl.tradition_title,
            stl.memo AS link_memo,
            tl.tradition_content,
            tl.tradition_area,
            tl.memo,
            tsl.source_id,
            tsl.source_name,
            tsl.page_info
        FROM star_tradition_link stl
        JOIN tradition_list tl
          ON tl.tradition_id = stl.tradition_id
         AND tl.is_published = true
        LEFT JOIN (
            SELECT tsl.tradition_id, tsl.source_id, sl.source_name, tsl.page_info
            FROM tradition_source_link tsl
            JOIN source_list sl
              ON sl.source_id = tsl.source_id
             AND sl.is_published = true
        ) tsl
          ON tsl.tradition_id = stl.tradition_id
        ORDER BY stl.star_culture_id, tl.tradition_title, stl.tradition_id, tsl.source_name, tsl.source_id
        """,
    )
    word_rows = query_rows(
        conn,
        """
        SELECT
            swl.star_culture_id,
            swl.word_order,
            swl.word_id,
            wm.word_ja,
            swl.memo AS link_memo,
            wm.word_en,
            wm.word_meaning,
            wm.memo,
            wsl.source_id,
            wsl.source_name,
            wsl.page_info
        FROM star_word_link swl
        LEFT JOIN word_master wm
          ON wm.word_id = swl.word_id
        LEFT JOIN (
            SELECT wsl.word_id, wsl.source_id, sl.source_name, wsl.page_info
            FROM word_source_link wsl
            JOIN source_list sl
              ON sl.source_id = wsl.source_id
             AND sl.is_published = true
        ) wsl
          ON wsl.word_id = swl.word_id
        ORDER BY swl.star_culture_id, swl.word_order, swl.word_id, wsl.source_name, wsl.source_id
        """,
    )

    lines_by_constellation = {}
    for row in line_rows:
        # constellation_key と line_no で点列をまとめる。
        # point_no の順序はSQL側の ORDER BY で保証し、ここでは append だけで線分順を保つ。
        key = row["constellation_key"]
        line_no = row["line_no"]
        hip_key = to_hip_key(row["hipparcos"])
        if hip_key:
            lines_by_constellation.setdefault(key, {}).setdefault(line_no, []).append(hip_key)

    astro_links_by_culture = {}
    for row in astro_rows:
        # 1つの星文化に複数の関連天体が紐づくため、星文化IDごとに配列で保持する。
        astro_name = to_text(row["astro_name"])
        if astro_name:
            astro_links_by_culture.setdefault(row["star_culture_id"], []).append(
                {
                    "astro_id": row["astro_id"],
                    "astro_name": astro_name,
                    "constellation": to_text(row["constellation"]),
                    "memo": to_text(row["memo"]),
                    "link_memo": to_text(row["link_memo"]),
                }
            )

    area_codes_by_culture = {}
    area_links_by_culture = {}
    for row in star_area_rows:
        # 検索画面の区分列・その他列で使う伝承地域名を、星文化IDごとに配列で保持する。
        # 地域区分Ⅰ-Ⅴの判定は、area_idで結合した地域名を正規化して行う。
        area_name = to_text(row["area_name"])
        if not area_name:
            continue

        code = s_area_to_aynu_code(area_name)
        if code in {"aynu1", "aynu2", "aynu3", "aynu4", "aynu5"}:
            area_codes = area_codes_by_culture.setdefault(row["star_culture_id"], [])
            if code not in area_codes:
                area_codes.append(code)

        area_links_by_culture.setdefault(row["star_culture_id"], []).append(
            {
                "area_id": row["area_id"],
                "area_name": area_name,
                "memo": to_text(row["memo"]),
                "link_memo": to_text(row["link_memo"]),
            }
        )

    source_links_by_culture = {}
    for row in source_rows:
        source_name = to_text(row["source_name"])
        if source_name:
            source_links_by_culture.setdefault(row["star_culture_id"], []).append(
                {
                    "source_id": row["source_id"],
                    "source_name": source_name,
                    "page_info": to_text(row["page_info"]),
                    "source_detail": to_text(row["source_detail"]),
                    "publisher": to_text(row["publisher"]),
                    "author": to_text(row["author"]),
                    "publication_date": to_text(row["publication_date"]),
                    "publication_area": to_text(row["publication_area"]),
                    "url": to_public_url(row["url"]),
                    "memo": to_text(row["memo"]),
                    "link_memo": to_text(row["link_memo"]),
                }
            )

    tradition_links_by_culture = {}
    for row in tradition_rows:
        tradition_title = to_text(row["tradition_title"])
        if tradition_title:
            tradition_links_by_culture.setdefault(row["star_culture_id"], []).append(
                {
                    "tradition_id": row["tradition_id"],
                    "tradition_title": tradition_title,
                    "tradition_content": to_text(row["tradition_content"]),
                    "tradition_area": to_text(row["tradition_area"]),
                    "source_id": row["source_id"],
                    "source_name": to_text(row["source_name"]),
                    "page_info": to_text(row["page_info"]),
                    "memo": to_text(row["memo"]),
                    "link_memo": to_text(row["link_memo"]),
                }
            )

    word_links_by_culture = {}
    for row in word_rows:
        word_ja = to_text(row["word_ja"])
        if word_ja:
            word_links_by_culture.setdefault(row["star_culture_id"], []).append(
                {
                    "word_order": to_int(row["word_order"]),
                    "word_id": row["word_id"],
                    "word_ja": word_ja,
                    "word_en": to_text(row["word_en"]),
                    "word_meaning": to_text(row["word_meaning"]),
                    "memo": to_text(row["memo"]),
                    "link_memo": to_text(row["link_memo"]),
                    "source_id": row["source_id"],
                    "source_name": to_text(row["source_name"]),
                    "page_info": to_text(row["page_info"]),
                }
            )

    constellations = []
    for row in culture_rows:
        constellation_key = row["constellation_key"]
        line_groups = lines_by_constellation.get(constellation_key, {})
        # 説明文は公開対象の意味・原義のみから作り、星文化情報本体の管理用メモは公開APIへ載せない。
        description = row["meaning"] or row["original_meaning"] or ""

        constellations.append(
            {
                "key": str(row["star_culture_id"]),
                "star_culture_id": row["star_culture_id"],
                "culture_cd": to_text(row["culture_cd"]),
                "culture_name": to_text(row["culture_name"]),
                "ra": to_float(row["ra"]),
                "dec": to_float(row["dec"]),
                "name": row["name_ja"] or "",
                "name_ja": row["name_ja"] or "",
                "name_en": row["name_en"] or "",
                "meaning": row["meaning"] or "",
                "constellation_key": row["constellation_key"] or "",
                "original_name_ja": row["original_name_ja"] or "",
                "original_name_en": row["original_name_en"] or "",
                "original_meaning": row["original_meaning"] or "",
                "description": description,
                "lines": [points for _, points in sorted(line_groups.items()) if points],
                "aynu": area_codes_by_culture.get(row["star_culture_id"], []),
                "is_published": True,
                "star_astro_link": astro_links_by_culture.get(row["star_culture_id"], []),
                "star_source_link": source_links_by_culture.get(row["star_culture_id"], []),
                "star_tradition_link": tradition_links_by_culture.get(row["star_culture_id"], []),
                "star_area_link": area_links_by_culture.get(row["star_culture_id"], []),
                "star_word_link": word_links_by_culture.get(row["star_culture_id"], []),
            }
        )

    return constellations


def fetch_city_map(conn):
    """市町村ごとの表示情報と、対応する星文化地域をまとめる。

    present_area_master をUI表示の主データとし、s_area_list_p をLEFT JOINして地域対応を付ける。
    市町村によって複数の星文化地域にまたがるため、1地域なら area、複数地域なら areas として
    既存フロントエンドの入力形式を保ちながら返す。
    """
    rows = query_rows(
        conn,
        """
        SELECT
            p.city,
            p.forecast,
            p.area,
            p.subprefecture,
            p.lat,
            p.lon,
            p.display,
            s.s_area
        FROM present_area_master p
        LEFT JOIN s_area_list_p s
          ON s.city = p.city
        WHERE p.is_published = true
        ORDER BY p.display, p.city, s.s_area
        """,
    )

    city_map = {}
    for row in rows:
        # LEFT JOIN のため同じ市町村が地域数ぶん複数行になる。
        # setdefault で市町村の基本情報は最初の行だけから作り、後続行では地域だけ追加する。
        city = row["city"]
        entry = city_map.setdefault(
            city,
            {
                "forecast": row["forecast"],
                "region": row["area"],
                "bureau": row["subprefecture"],
                "lat": to_float(row["lat"]),
                "lon": to_float(row["lon"]),
                "display": to_int(row["display"]),
            },
        )

        code = s_area_to_aynu_code(row["s_area"])
        area_keys = aynu_codes_to_area_keys([code] if code else [])
        if not area_keys:
            continue

        area_key = area_keys[0]
        # 旧形式の area と、新形式の areas の両方に対応するため、
        # 1地域目は area、2地域目以降が現れた時点で areas 配列へ移行する。
        if "area" not in entry and "areas" not in entry:
            entry["area"] = area_key
        elif entry.get("area") and entry["area"] != area_key:
            entry["areas"] = [entry.pop("area"), area_key]
        elif "areas" in entry and area_key not in entry["areas"]:
            entry["areas"].append(area_key)

    return city_map


def build_aynu_data(conn=None):
    """APIレスポンス全体を組み立てる。

    テストやバッチから既存接続を渡せるよう conn を任意にし、Lambda通常実行ではこの関数内で接続を開閉する。
    返却キー名はフロントエンドの loadAllAynuData() と一致させている。
    """
    if conn is not None:
        return {
            "stars": fetch_stars(conn),
            "constellations": fetch_constellations(conn),
            "cityMap": fetch_city_map(conn),
        }

    with get_connection() as owned_conn:
        return {
            "stars": fetch_stars(owned_conn),
            "constellations": fetch_constellations(owned_conn),
            "cityMap": fetch_city_map(owned_conn),
        }


# ============================================================
# 編集画面用CRUD API
# ============================================================
# /edit 配下の管理画面から扱うテーブルを明示的にホワイトリスト化する。
# テーブル名・列名はユーザー入力からSQLへ直接渡さず、この定義内の識別子だけを psycopg2.sql で組み立てる。

ADMIN_UPDATED_BY_COLUMN = "updated_by"


def get_admin_table_definition(table_name):
    """編集対象テーブルの定義を返す。未許可テーブル名はここで拒否する。"""
    if table_name not in ADMIN_TABLES:
        raise ValueError(f"編集対象外のテーブルです: {table_name}")
    return ADMIN_TABLES[table_name]


def get_admin_tables_metadata():
    """編集画面のテーブル切り替えに使うメタデータを返す。"""
    tables = []
    for name, definition in ADMIN_TABLES.items():
        tables.append(
            {
                "name": name,
                "label": definition["label"],
                "primaryKey": definition["primary_key"],
                "primaryKeys": admin_primary_key_columns(definition),
                "listColumns": definition["list_columns"],
                "defaultSort": definition["default_sort"],
                "columns": definition["columns"],
            }
        )
    return {"tables": tables}


def get_admin_lookup_options():
    """コードマスタから編集画面のプルダウン選択肢を取得する。"""
    options = {}
    with get_connection() as conn:
        for key, definition in ADMIN_LOOKUP_TABLES.items():
            order_columns = definition.get("order_by") or [definition["value_column"]]
            rows = query_rows(
                conn,
                sql.SQL(
                    "SELECT {value_column} AS value, {label_column} AS label "
                    "FROM {table} ORDER BY {order_by}"
                ).format(
                    value_column=sql.Identifier(definition["value_column"]),
                    label_column=sql.Identifier(definition["label_column"]),
                    table=sql.Identifier(definition["table"]),
                    order_by=sql.SQL(", ").join(sql.Identifier(column) for column in order_columns),
                ),
            )
            options[key] = [
                {
                    "value": to_text(row["value"]),
                    "label": to_text(row["label"]),
                }
                for row in rows
            ]

        # 星図の参照キーは内部値に保ち、選択肢には対応する星文化の名称を使う。
        names_by_key = {}
        for row in query_rows(
            conn,
            "SELECT constellation_key AS value, name_ja AS label FROM star_culture "
            "WHERE constellation_key IS NOT NULL ORDER BY name_ja, star_culture_id",
        ):
            names = names_by_key.setdefault(to_text(row["value"]), [])
            name = to_text(row["label"])
            if name and name not in names:
                names.append(name)
        for option in options["constellation_key"]:
            option["label"] = "、".join(names_by_key.get(option["value"], [])) or "名称未登録の星図"

    return {"options": options}


def admin_column_names(definition, include_readonly=True):
    """テーブル定義からSELECT/RETURNINGに使う列名配列を作る。"""
    return [
        column["name"]
        for column in definition["columns"]
        if include_readonly or not column.get("readonly")
    ]


def admin_column_by_name(definition):
    """列名から列定義へ引ける辞書を作る。"""
    return {column["name"]: column for column in definition["columns"]}


def admin_primary_key_columns(definition):
    return definition.get("primary_keys") or [definition["primary_key"]]


def normalize_admin_primary_key(definition, value):
    """Single keys remain scalar; composite keys are JSON objects in the pk parameter."""
    keys = admin_primary_key_columns(definition)
    if not isinstance(value, dict):
        if len(keys) == 1:
            value = {keys[0]: value}
        else:
            try:
                value = json.loads(value)
            except (TypeError, ValueError) as exc:
                raise ValueError("複合主キーは各主キー列を含むJSONオブジェクトで指定してください") from exc
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(f"主キーには {', '.join(keys)} を指定してください")
    columns = admin_column_by_name(definition)
    return {key: normalize_admin_value(dict(columns[key], required=True), value[key]) for key in keys}


def admin_primary_key_where(definition, value):
    values = normalize_admin_primary_key(definition, value)
    where = sql.SQL(" AND ").join(
        sql.SQL("{} = %s").format(sql.Identifier(key)) for key in values
    )
    return where, list(values.values())


def apply_admin_updated_by(values, updated_by):
    """画面には出さない監査列 updated_by へログインアカウントを入れる。"""
    account = str(updated_by or "").strip()
    if account:
        values[ADMIN_UPDATED_BY_COLUMN] = account


def apply_admin_table_updated_by(definition, values, updated_by):
    """updated_by列を持つ編集対象テーブルだけに更新者を入れる。"""
    if definition.get("updated_by"):
        apply_admin_updated_by(values, updated_by)


def apply_admin_sequence_primary_key(conn, definition, values):
    """主キー用シーケンスがあるテーブルでは未指定時に採番する。"""
    sequence_name = definition.get("primary_key_sequence")
    primary_key = definition["primary_key"]
    if not sequence_name or values.get(primary_key) not in (None, ""):
        return

    rows = query_rows(
        conn,
        sql.SQL("SELECT nextval({sequence}::regclass) AS value").format(
            sequence=sql.Literal(sequence_name),
        ),
    )
    values[primary_key] = int(rows[0]["value"])


def reject_admin_primary_key_change(definition, values, primary_key_value):
    """更新時に主キーが変更されないことを確認し、同値なら更新対象から外す。"""
    current = normalize_admin_primary_key(definition, primary_key_value)
    for key, value in current.items():
        if key in values:
            if values[key] != value:
                raise ValueError("主キーは変更できません")
            del values[key]


def serialize_admin_value(value):
    """DB値を管理画面APIのJSONレスポンスへ載せられる値に変換する。"""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def serialize_admin_row(row):
    """RealDictRowを通常のdictへ変換し、日付型などをJSON向けに整える。"""
    return {key: serialize_admin_value(value) for key, value in dict(row).items()}


def normalize_admin_bool(value):
    """フォーム由来の真偽値をPostgreSQLへ渡せるboolへ正規化する。"""
    if isinstance(value, bool):
        return value
    if value is None or value == "":
        return False
    if isinstance(value, (int, float)):
        return bool(value)

    text = str(value).strip().lower()
    if text in {"true", "t", "1", "yes", "y", "on"}:
        return True
    if text in {"false", "f", "0", "no", "n", "off"}:
        return False
    raise ValueError(f"真偽値として解釈できません: {value}")


def normalize_admin_value(column, value):
    """列定義に従ってリクエスト値をDB保存用へ正規化する。"""
    column_type = column.get("value_type", column.get("type", "text"))

    if column_type == "boolean":
        return normalize_admin_bool(value)

    if value is None:
        if column.get("required"):
            raise ValueError(f"{column['label']}は必須です")
        return None

    text = str(value).strip()
    if text == "":
        if column.get("required"):
            raise ValueError(f"{column['label']}は必須です")
        return None

    max_length = column.get("max_length")
    if max_length and len(text) > max_length:
        raise ValueError(f"{column['label']}は{max_length}文字以内で入力してください")

    if column_type == "integer":
        try:
            number = int(text)
        except ValueError as exc:
            raise ValueError(f"{column['label']}は整数で入力してください") from exc
        bits = column.get("bits", 64)
        if not -(2 ** (bits - 1)) <= number < 2 ** (bits - 1):
            raise ValueError(f"{column['label']}は{bits}ビット整数の範囲で入力してください")
        return number

    if column_type == "number":
        try:
            precision, scale = column["precision"], column["scale"]
            with localcontext() as context:
                context.prec = max(precision + 2, 32)
                number = Decimal(text).quantize(Decimal(1).scaleb(-scale), rounding=ROUND_HALF_UP)
            if not number.is_finite() or abs(number) >= Decimal(10) ** (precision - scale):
                raise ValueError(f"{column['label']}はnumeric({precision},{scale})の範囲で入力してください")
            return number
        except InvalidOperation as exc:
            raise ValueError(f"{column['label']}は数値で入力してください") from exc

    if column.get("options") and text not in {str(item["value"]) for item in column["options"]}:
        raise ValueError(f"{column['label']}は選択肢から指定してください")

    if column_type == "date":
        # PostgreSQLにも日付検証はあるが、API側で先に弾くと画面に分かりやすいエラーを返せる。
        try:
            date.fromisoformat(text)
        except ValueError as exc:
            raise ValueError(f"{column['label']}はYYYY-MM-DD形式で入力してください") from exc

    if column_type == "url":
        parsed = urlparse(text)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"{column['label']}はhttp://またはhttps://から始まるURLを入力してください")

    return text


def normalize_admin_payload(definition, payload, *, require_required_fields):
    """JSONリクエストボディを許可列だけに絞り、型と必須条件を検証する。"""
    if not isinstance(payload, dict):
        raise ValueError("JSONオブジェクトを送信してください")

    normalized = {}
    columns_by_name = admin_column_by_name(definition)

    for name, column in columns_by_name.items():
        if column.get("readonly"):
            continue

        if name in payload:
            normalized[name] = normalize_admin_value(column, payload.get(name))
        elif column.get("type") == "boolean" and "default" in column and require_required_fields:
            normalized[name] = bool(column["default"])

    if require_required_fields:
        validate_admin_required_fields(definition, normalized)

    return normalized


def validate_admin_required_fields(definition, values, *, include_primary_key=True):
    """DDLのNOT NULLに対応する必須列が保存値に含まれていることを確認する。"""
    primary_keys = admin_primary_key_columns(definition)
    for column in definition["columns"]:
        if column.get("readonly") or not column.get("required"):
            continue

        name = column["name"]
        if not include_primary_key and name in primary_keys:
            continue

        if name not in values or values.get(name) in (None, ""):
            raise ValueError(f"{column['label']}は必須です")


def hira_to_kata(text):
    """ひらがなをカタカナへ寄せる。星文化DB画面の検索正規化に合わせる。"""
    return "".join(
        chr(ord(char) + 0x60) if "\u3041" <= char <= "\u3096" else char
        for char in text
    )


def kata_to_hira(text):
    """カタカナをひらがなへ寄せ、逆方向の表記ゆれも検索できるようにする。"""
    return "".join(
        chr(ord(char) - 0x60) if "\u30a1" <= char <= "\u30f6" else char
        for char in text
    )


def get_admin_search_variants(query_text):
    """管理画面検索用に、かな/カナ表記ゆれを吸収する検索語候補を作る。"""
    values = [
        str(query_text or "").strip(),
        unicodedata.normalize("NFKC", str(query_text or "")).strip(),
    ]

    normalized = values[-1]
    values.extend([hira_to_kata(normalized), kata_to_hira(normalized)])

    variants = []
    for value in values:
        if value and value not in variants:
            variants.append(value)
    return variants


def build_admin_where_search(definition, query_text):
    """検索語がある場合だけ ILIKE 条件とパラメータを組み立てる。"""
    query_variants = get_admin_search_variants(query_text)
    if not query_variants:
        return sql.SQL(""), []

    search_columns = definition.get("search_columns") or [definition["primary_key"]]
    conditions = [
        sql.SQL("{}::text ILIKE %s").format(sql.Identifier(column_name))
        for column_name in search_columns
        for _ in query_variants
    ]
    where_sql = sql.SQL(" WHERE ") + sql.SQL(" OR ").join(conditions)
    params = [
        f"%{query_variant}%"
        for _ in search_columns
        for query_variant in query_variants
    ]
    return where_sql, params


def get_admin_order_columns(definition):
    """一覧表示に使う昇順ソート列を返す。未指定テーブルは主キー昇順にする。"""
    return definition.get("order_by") or [definition["primary_key"]]


def get_admin_star_culture_links(conn, star_culture_id):
    """星文化情報に紐づく各リンクテーブルの行を取得する。"""
    params = [star_culture_id]
    astro_rows = query_rows(
        conn,
        """
        SELECT astro_id, memo
        FROM star_astro_link
        WHERE star_culture_id = %s
        ORDER BY astro_id
        """,
        params,
    )
    source_rows = query_rows(
        conn,
        """
        SELECT source_id, page_info, memo
        FROM star_source_link
        WHERE star_culture_id = %s
        ORDER BY source_id
        """,
        params,
    )
    tradition_rows = query_rows(
        conn,
        """
        SELECT tradition_id, memo
        FROM star_tradition_link
        WHERE star_culture_id = %s
        ORDER BY tradition_id
        """,
        params,
    )
    tradition_source_rows = query_rows(
        conn,
        """
        SELECT tsl.tradition_id, tsl.source_id, tsl.page_info, tsl.memo
        FROM tradition_source_link tsl
        WHERE EXISTS (
            SELECT 1
            FROM star_tradition_link stl
            WHERE stl.star_culture_id = %s
              AND stl.tradition_id = tsl.tradition_id
        )
        ORDER BY tsl.tradition_id, tsl.source_id
        """,
        params,
    )
    area_rows = query_rows(
        conn,
        """
        SELECT area_id, memo
        FROM star_area_link
        WHERE star_culture_id = %s
        ORDER BY area_id
        """,
        params,
    )
    word_rows = query_rows(
        conn,
        """
        SELECT word_order, word_id, memo
        FROM star_word_link
        WHERE star_culture_id = %s
        ORDER BY word_order
        """,
        params,
    )

    return {
        "astro": [serialize_admin_row(row) for row in astro_rows],
        "source": [serialize_admin_row(row) for row in source_rows],
        "tradition": [serialize_admin_row(row) for row in tradition_rows],
        "tradition_source": [serialize_admin_row(row) for row in tradition_source_rows],
        "area": [serialize_admin_row(row) for row in area_rows],
        "word": [serialize_admin_row(row) for row in word_rows],
    }


def normalize_link_text(row, name, label, *, required=False, max_length=None):
    value = str((row or {}).get(name) or "").strip()
    if required and not value:
        raise ValueError(f"{label}は必須です")
    if max_length and len(value) > max_length:
        raise ValueError(f"{label}は{max_length}文字以内で入力してください")
    return value or None


def normalize_link_int(row, name, label, *, required=False):
    value = (row or {}).get(name)
    if value is None or value == "":
        if required:
            raise ValueError(f"{label}は必須です")
        return None
    try:
        return normalize_admin_value(
            {"label": label, "type": "integer", "bits": 32 if name == "word_order" else 64}, value
        )
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label}は整数で入力してください") from exc


def reject_duplicate_link(keys, label, seen):
    if keys in seen:
        raise ValueError(f"{label}が重複しています")
    seen.add(keys)


def normalize_admin_star_culture_links(raw_links):
    """星文化リンク編集payloadをDDLに合わせて正規化する。"""
    if not isinstance(raw_links, dict):
        raise ValueError("リンク情報はJSONオブジェクトで送信してください")
    links = raw_links
    for key, rows in links.items():
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError(f"{key}のリンク情報は行オブジェクトの配列で送信してください")
    normalized = {
        "astro": [],
        "source": [],
        "tradition": [],
        "tradition_source": [],
        "area": [],
        "word": [],
    }

    seen = set()
    for row in links.get("astro") or []:
        item = {
            "astro_id": normalize_link_int(row, "astro_id", "天体名", required=True),
            "memo": normalize_link_text(row, "memo", "メモ"),
        }
        reject_duplicate_link(item["astro_id"], "天体リンク", seen)
        normalized["astro"].append(item)

    seen = set()
    for row in links.get("source") or []:
        item = {
            "source_id": normalize_link_int(row, "source_id", "出典名", required=True),
            "page_info": normalize_link_text(row, "page_info", "ページ情報", max_length=32),
            "memo": normalize_link_text(row, "memo", "メモ"),
        }
        reject_duplicate_link(item["source_id"], "出典リンク", seen)
        normalized["source"].append(item)

    seen = set()
    for row in links.get("tradition") or []:
        item = {
            "tradition_id": normalize_link_int(row, "tradition_id", "伝承タイトル", required=True),
            "memo": normalize_link_text(row, "memo", "メモ"),
        }
        reject_duplicate_link(item["tradition_id"], "伝承リンク", seen)
        normalized["tradition"].append(item)

    seen = set()
    for row in links.get("tradition_source") or []:
        item = {
            "tradition_id": normalize_link_int(row, "tradition_id", "伝承タイトル", required=True),
            "source_id": normalize_link_int(row, "source_id", "出典名", required=True),
            "page_info": normalize_link_text(row, "page_info", "ページ情報", max_length=32),
            "memo": normalize_link_text(row, "memo", "メモ"),
        }
        reject_duplicate_link((item["tradition_id"], item["source_id"]), "伝承出典リンク", seen)
        normalized["tradition_source"].append(item)

    seen = set()
    for row in links.get("area") or []:
        item = {
            "area_id": normalize_link_int(row, "area_id", "地域名", required=True),
            "memo": normalize_link_text(row, "memo", "メモ"),
        }
        reject_duplicate_link(item["area_id"], "地域リンク", seen)
        normalized["area"].append(item)

    seen = set()
    for row in links.get("word") or []:
        item = {
            "word_order": normalize_link_int(row, "word_order", "単語順", required=True),
            "word_id": normalize_link_int(row, "word_id", "単語", required=True),
            "memo": normalize_link_text(row, "memo", "メモ"),
        }
        reject_duplicate_link(item["word_order"], "単語リンクの順序", seen)
        normalized["word"].append(item)

    linked_traditions = {row["tradition_id"] for row in normalized["tradition"]}
    for row in normalized["tradition_source"]:
        if row["tradition_id"] not in linked_traditions:
            raise ValueError("伝承出典リンクの伝承タイトルは星文化伝承リンクにも追加してください")

    return normalized


def validate_admin_references(conn, references):
    """DDLに外部キー制約がないため、保存するID・コードの参照先を確認する。"""
    for key, values in references.items():
        if not values:
            continue
        definition = ADMIN_LOOKUP_TABLES[key]
        rows = query_rows(
            conn,
            sql.SQL("SELECT {column} AS value FROM {table} WHERE {column} = ANY(%s) FOR KEY SHARE").format(
                column=sql.Identifier(definition["value_column"]),
                table=sql.Identifier(definition["table"]),
            ),
            [list(values)],
        )
        missing = {str(value) for value in values} - {str(row["value"]) for row in rows}
        if missing:
            label = SCHEMA_TABLES[definition["table"]]["label"]
            raise ValueError(f"{label}の選択を確認してください。未登録の参照先があります")


def validate_admin_column_references(conn, definition, values):
    references = {
        column["lookup"]: [values[column["name"]]]
        for column in definition["columns"]
        if column.get("lookup") and values.get(column["name"]) not in (None, "")
    }
    validate_admin_references(conn, references)


def replace_admin_star_culture_links(conn, star_culture_id, raw_links):
    """星文化情報のリンク行を画面payloadの内容で置き換える。"""
    links = normalize_admin_star_culture_links(raw_links)
    references = {}
    for rows in links.values():
        for row in rows:
            for key in ("astro_id", "source_id", "tradition_id", "area_id", "word_id"):
                if key in row:
                    references.setdefault(key, set()).add(row[key])
    validate_admin_references(conn, references)

    for table in ("star_astro_link", "star_source_link", "star_tradition_link", "star_area_link", "star_word_link"):
        execute_query(
            conn,
            sql.SQL("DELETE FROM {table} WHERE star_culture_id = %s").format(table=sql.Identifier(table)),
            [star_culture_id],
        )

    for row in links["astro"]:
        execute_query(
            conn,
            """
            INSERT INTO star_astro_link (star_culture_id, astro_id, memo)
            VALUES (%s, %s, %s)
            """,
            [star_culture_id, row["astro_id"], row["memo"]],
        )
    for row in links["source"]:
        execute_query(
            conn,
            """
            INSERT INTO star_source_link (star_culture_id, source_id, page_info, memo)
            VALUES (%s, %s, %s, %s)
            """,
            [star_culture_id, row["source_id"], row["page_info"], row["memo"]],
        )
    for row in links["tradition"]:
        execute_query(
            conn,
            """
            INSERT INTO star_tradition_link (star_culture_id, tradition_id, memo)
            VALUES (%s, %s, %s)
            """,
            [star_culture_id, row["tradition_id"], row["memo"]],
        )
    for row in links["tradition_source"]:
        execute_query(
            conn,
            """
            INSERT INTO tradition_source_link (tradition_id, source_id, page_info, memo)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (tradition_id, source_id)
            DO UPDATE SET page_info = EXCLUDED.page_info, memo = EXCLUDED.memo
            """,
            [row["tradition_id"], row["source_id"], row["page_info"], row["memo"]],
        )
    for row in links["area"]:
        execute_query(
            conn,
            """
            INSERT INTO star_area_link (star_culture_id, area_id, memo)
            VALUES (%s, %s, %s)
            """,
            [star_culture_id, row["area_id"], row["memo"]],
        )
    for row in links["word"]:
        execute_query(
            conn,
            """
            INSERT INTO star_word_link (star_culture_id, word_order, word_id, memo)
            VALUES (%s, %s, %s, %s)
            """,
            [star_culture_id, row["word_order"], row["word_id"], row["memo"]],
        )


def list_admin_table_rows(table_name, query_text="", limit=500, offset=0, sort_column=None, sort_direction="asc"):
    """編集対象テーブルの行を検索・ページング付きで取得する。"""
    definition = get_admin_table_definition(table_name)
    primary_key = definition["primary_key"]
    columns = admin_column_names(definition)
    fields_sql = sql.SQL(", ").join(sql.Identifier(column) for column in columns)
    order_columns = get_admin_order_columns(definition)
    if sort_column:
        if sort_column not in columns or sort_direction not in {"asc", "desc"}:
            raise ValueError("並べ替え列・順序の指定が不正です")
        order_columns = list(dict.fromkeys([sort_column] + admin_primary_key_columns(definition)))
    direction = sql.SQL("DESC" if sort_column and sort_direction == "desc" else "ASC")
    order_sql = sql.SQL(", ").join(
        sql.SQL("{} {} NULLS LAST").format(sql.Identifier(column), direction) for column in order_columns
    )
    where_sql, params = build_admin_where_search(definition, (query_text or "").strip())

    try:
        limit_value = max(1, min(int(limit), 1000))
    except (TypeError, ValueError):
        limit_value = 500

    try:
        offset_value = max(0, int(offset))
    except (TypeError, ValueError):
        offset_value = 0

    with get_connection() as conn:
        rows = query_rows(
            conn,
            sql.SQL(
                "SELECT {fields} FROM {table} {where} ORDER BY {order_by} LIMIT %s OFFSET %s"
            ).format(
                fields=fields_sql,
                table=sql.Identifier(table_name),
                where=where_sql,
                order_by=order_sql,
            ),
            [*params, limit_value, offset_value],
        )
        count_rows = query_rows(
            conn,
            sql.SQL("SELECT COUNT(*) AS total FROM {table} {where}").format(
                table=sql.Identifier(table_name),
                where=where_sql,
            ),
            params,
        )

    total = int(count_rows[0]["total"]) if count_rows else 0
    return {
        "table": table_name,
        "label": definition["label"],
        "primaryKey": primary_key,
        "primaryKeys": admin_primary_key_columns(definition),
        "columns": definition["columns"],
        "rows": [serialize_admin_row(row) for row in rows],
        "total": total,
        "limit": limit_value,
        "offset": offset_value,
    }


def get_admin_table_row(table_name, primary_key_value):
    """主キーで指定した編集対象テーブルの1行を取得する。"""
    definition = get_admin_table_definition(table_name)
    primary_key = definition["primary_key"]
    columns = admin_column_names(definition)
    fields_sql = sql.SQL(", ").join(sql.Identifier(column) for column in columns)
    where_sql, key_params = admin_primary_key_where(definition, primary_key_value)

    with get_connection() as conn:
        rows = query_rows(
            conn,
            sql.SQL(
                "SELECT {fields} FROM {table} WHERE {where}"
            ).format(
                fields=fields_sql,
                table=sql.Identifier(table_name),
                where=where_sql,
            ),
            key_params,
        )
        if not rows:
            return None

        row = serialize_admin_row(rows[0])
        if table_name == "star_culture":
            row["links"] = get_admin_star_culture_links(conn, row[primary_key])
        return row


def create_admin_table_row(table_name, payload, updated_by=None):
    """編集対象テーブルへ1行追加する。"""
    definition = get_admin_table_definition(table_name)
    values = normalize_admin_payload(definition, payload, require_required_fields=True)
    apply_admin_table_updated_by(definition, values, updated_by)
    returning_columns = admin_column_names(definition)

    with get_connection() as conn:
        validate_admin_column_references(conn, definition, values)
        apply_admin_sequence_primary_key(conn, definition, values)
        if not values:
            raise ValueError("登録する値がありません")

        columns = list(values.keys())
        rows = query_rows(
            conn,
            sql.SQL(
                "INSERT INTO {table} ({columns}) VALUES ({placeholders}) RETURNING {returning}"
            ).format(
                table=sql.Identifier(table_name),
                columns=sql.SQL(", ").join(sql.Identifier(column) for column in columns),
                placeholders=sql.SQL(", ").join(sql.Placeholder() for _ in columns),
                returning=sql.SQL(", ").join(sql.Identifier(column) for column in returning_columns),
            ),
            [values[column] for column in columns],
        )

        row = serialize_admin_row(rows[0])
        if table_name == "star_culture" and isinstance(payload, dict) and "links" in payload:
            replace_admin_star_culture_links(conn, row[definition["primary_key"]], payload.get("links"))
            row["links"] = get_admin_star_culture_links(conn, row[definition["primary_key"]])
        return row


def update_admin_table_row(table_name, primary_key_value, payload, updated_by=None):
    """主キーで指定した1行を更新する。主キー列自体の変更は許可しない。"""
    definition = get_admin_table_definition(table_name)
    primary_key = definition["primary_key"]
    where_sql, key_params = admin_primary_key_where(definition, primary_key_value)
    values = normalize_admin_payload(definition, payload, require_required_fields=False)
    reject_admin_primary_key_change(definition, values, primary_key_value)
    validate_admin_required_fields(definition, values, include_primary_key=False)
    apply_admin_table_updated_by(definition, values, updated_by)
    returning_columns = admin_column_names(definition)

    assignments = [
        sql.SQL("{} = %s").format(sql.Identifier(column))
        for column in values.keys()
    ]
    params = [values[column] for column in values.keys()]

    if "updated_at" in admin_column_names(definition) and "updated_at" not in values:
        assignments.append(
            sql.SQL("updated_at = CURRENT_TIMESTAMP AT TIME ZONE {timezone}").format(
                timezone=sql.Literal(DB_TIME_ZONE),
            )
        )

    if not assignments:
        raise ValueError("更新する値がありません")

    params.extend(key_params)

    with get_connection() as conn:
        validate_admin_column_references(conn, definition, values)
        rows = query_rows(
            conn,
            sql.SQL(
                "UPDATE {table} SET {assignments} WHERE {where} RETURNING {returning}"
            ).format(
                table=sql.Identifier(table_name),
                assignments=sql.SQL(", ").join(assignments),
                where=where_sql,
                returning=sql.SQL(", ").join(sql.Identifier(column) for column in returning_columns),
            ),
            params,
        )

        if not rows:
            return None

        row = serialize_admin_row(rows[0])
        if table_name == "star_culture" and isinstance(payload, dict) and "links" in payload:
            replace_admin_star_culture_links(conn, row[primary_key], payload.get("links"))
            row["links"] = get_admin_star_culture_links(conn, row[primary_key])
        return row


def delete_admin_table_row(table_name, primary_key_value):
    """主キーで指定した1行を削除する。"""
    definition = get_admin_table_definition(table_name)
    primary_key = definition["primary_key"]
    returning_columns = admin_column_names(definition)
    where_sql, key_params = admin_primary_key_where(definition, primary_key_value)
    owned_links = {"star_astro_link", "star_source_link", "star_tradition_link", "star_area_link", "star_word_link", "usage_status"}

    with get_connection() as conn:
        existing = query_rows(
            conn,
            sql.SQL("SELECT {fields} FROM {table} WHERE {where} FOR UPDATE").format(
                fields=sql.SQL(", ").join(sql.Identifier(column) for column in returning_columns),
                table=sql.Identifier(table_name), where=where_sql,
            ), key_params,
        )
        if not existing:
            return None
        for child_name, child_definition in SCHEMA_TABLES.items():
            if table_name == "star_culture" and child_name in owned_links:
                continue
            for column in child_definition["columns"]:
                lookup = ADMIN_LOOKUP_TABLES.get(column.get("lookup"))
                if not lookup or lookup["table"] != table_name:
                    continue
                references = query_rows(
                    conn,
                    sql.SQL("SELECT 1 FROM {table} WHERE {column} = %s LIMIT 1").format(
                        table=sql.Identifier(child_name), column=sql.Identifier(column["name"]),
                    ), [existing[0][lookup["value_column"]]],
                )
                if references:
                    raise ValueError(f"{child_definition['label']}で参照されているため削除できません")
        if table_name == "star_culture":
            for table in sorted(owned_links):
                execute_query(
                    conn,
                    sql.SQL("DELETE FROM {table} WHERE star_culture_id = %s").format(table=sql.Identifier(table)),
                    [existing[0][primary_key]],
                )

        rows = query_rows(
            conn,
            sql.SQL(
                "DELETE FROM {table} WHERE {where} RETURNING {returning}"
            ).format(
                table=sql.Identifier(table_name),
                where=where_sql,
                returning=sql.SQL(", ").join(sql.Identifier(column) for column in returning_columns),
            ),
            key_params,
        )

    return serialize_admin_row(rows[0]) if rows else None
