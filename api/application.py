import json
import os
from decimal import Decimal
from pathlib import Path

import psycopg2
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from psycopg2 import sql
from psycopg2.extras import RealDictCursor


ROOT_DIR = Path(__file__).resolve().parent.parent
FALLBACK_DATA_DIR = Path(os.environ.get("AYNU_FALLBACK_DATA_DIR", ROOT_DIR / "v041" / "data"))

application = Flask(__name__, static_folder=None)

cors_origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", "*").split(",") if origin.strip()]
CORS(application, resources={r"/api/*": {"origins": cors_origins or "*"}})


class DataShapeError(RuntimeError):
    pass


def use_file_fallback():
    return os.environ.get("AYNU_USE_FILE_FALLBACK", "true").lower() not in {"0", "false", "no"}


def load_fallback_json(filename):
    if not use_file_fallback():
        raise DataShapeError(f"{filename} is not available from the database.")

    path = FALLBACK_DATA_DIR / filename
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_fallback_stars():
    return load_fallback_json("star.json")


def load_fallback_constellations():
    return load_fallback_json("constellation.json")


def load_fallback_city_map():
    return build_city_map(load_fallback_json("city.json"))


def get_conn():
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
    )


def query_rows(conn, query, params=None):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query, params or ())
        return cur.fetchall()


def get_table_columns(conn, table_name):
    rows = query_rows(
        conn,
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table_name,),
    )
    return {row["column_name"] for row in rows}


def find_table(conn, candidates):
    for table in candidates:
        columns = get_table_columns(conn, table)
        if columns:
            return table, columns
    return None, set()


def first_column(columns, candidates):
    return next((column for column in candidates if column in columns), None)


def parse_json_value(value, default):
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return default
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            return [item.strip() for item in stripped.split(",") if item.strip()]
    return value


def to_float(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_star_key(value, source_column):
    if value is None:
        return None
    key = str(value).strip()
    if source_column in {"hip", "hip_id", "hip_number", "hipparcos"} and key and not key.startswith("HIP_"):
        return f"HIP_{key}"
    return key


def select_rows(conn, table, columns, selected_columns, published_column=None, order_column=None):
    identifiers = [sql.Identifier(column) for column in selected_columns]
    query = sql.SQL("SELECT {fields} FROM {table}").format(
        fields=sql.SQL(", ").join(identifiers),
        table=sql.Identifier(table),
    )
    if published_column:
        query += sql.SQL(" WHERE {} = true").format(sql.Identifier(published_column))
    if order_column:
        query += sql.SQL(" ORDER BY {}").format(sql.Identifier(order_column))

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query)
        return cur.fetchall()


def fetch_stars(conn):
    table, columns = find_table(conn, ("star_master", "star", "stars", "hip_star", "hip_stars", "hipparcos", "hipparcos_star", "hipparcos_stars"))
    if not table:
        return load_fallback_stars()

    key_column = first_column(columns, ("hipparcos", "hip_key", "key", "code", "hip", "hip_id", "hip_number", "star_id", "id"))
    ra_column = first_column(columns, ("ra", "ra_deg", "right_ascension"))
    dec_column = first_column(columns, ("dec", "dec_deg", "declination"))
    if not key_column or not ra_column or not dec_column:
        return load_fallback_stars()

    rows = select_rows(conn, table, columns, [key_column, ra_column, dec_column], order_column=key_column)
    stars = {}
    for row in rows:
        key = to_star_key(row.get(key_column), key_column)
        ra = to_float(row.get(ra_column))
        dec = to_float(row.get(dec_column))
        if key and ra is not None and dec is not None:
            stars[key] = {"ra": ra, "dec": dec}
    return stars or load_fallback_stars()


def fetch_constellations(conn):
    exact_tables = {
        "star_culture": get_table_columns(conn, "star_culture"),
        "constellation_list": get_table_columns(conn, "constellation_list"),
        "constellation_line_list": get_table_columns(conn, "constellation_line_list"),
        "s_area_list_c": get_table_columns(conn, "s_area_list_c"),
    }
    if all(exact_tables.values()):
        return fetch_constellations_from_ddl(conn) or load_fallback_constellations()

    table, columns = find_table(conn, ("star_culture", "star_cultures", "constellation", "constellations"))
    if not table:
        return load_fallback_constellations()

    key_column = first_column(columns, ("key", "code", "star_culture_key", "star_culture_id", "constellation_id", "id"))
    name_column = first_column(columns, ("name", "name_ja", "title", "title_ja"))
    description_column = first_column(columns, ("description", "description_ja", "body", "body_ja"))
    ra_column = first_column(columns, ("ra", "ra_deg", "label_ra"))
    dec_column = first_column(columns, ("dec", "dec_deg", "label_dec"))
    lines_column = first_column(columns, ("lines", "line_segments", "star_lines"))
    aynu_column = first_column(columns, ("aynu", "aynu_codes", "culture_areas", "area_codes"))
    published_column = "is_published" if "is_published" in columns else None

    if not key_column or not name_column:
        return load_fallback_constellations()

    if not lines_column or not aynu_column:
        return load_fallback_constellations()

    selected_columns = [
        column
        for column in (key_column, name_column, description_column, ra_column, dec_column, lines_column, aynu_column)
        if column
    ]
    rows = select_rows(conn, table, columns, selected_columns, published_column=published_column, order_column=key_column)

    constellations = []
    for row in rows:
        constellations.append(
            {
                "key": str(row.get(key_column)),
                "ra": to_float(row.get(ra_column)) if ra_column else None,
                "dec": to_float(row.get(dec_column)) if dec_column else None,
                "name": row.get(name_column) or "",
                "description": row.get(description_column) if description_column else "",
                "lines": parse_json_value(row.get(lines_column), []) if lines_column else [],
                "aynu": parse_json_value(row.get(aynu_column), []) if aynu_column else [],
            }
        )
    return constellations or load_fallback_constellations()


def aynu_codes_to_area_keys(codes):
    mapping = {
        "aynu1": "area1",
        "aynu2": "area2",
        "aynu3": "area3",
        "aynu4": "area4",
        "aynu5": "area5",
    }
    keys = []
    for code in parse_json_value(codes, []):
        key = mapping.get(str(code))
        if key and key not in keys:
            keys.append(key)
    return keys


def s_area_to_aynu_code(value):
    area = str(value).strip()
    if area in {"1", "2", "3", "4", "5"}:
        return f"aynu{area}"
    if area.startswith("aynu"):
        return area
    return None


def fetch_constellations_from_ddl(conn):
    culture_rows = query_rows(
        conn,
        """
        SELECT
            sc.star_culture_id,
            sc.name_ja,
            sc.meaning,
            sc.original_meaning,
            sc.memo,
            sc.constellation_key,
            cl.ra,
            cl."dec"
        FROM star_culture sc
        LEFT JOIN constellation_list cl
          ON cl.constellation_key = sc.constellation_key
        WHERE sc.is_published = true
          AND (cl.constellation_key IS NULL OR cl.is_published = true)
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
    area_rows = query_rows(
        conn,
        """
        SELECT constellation_key, s_area
        FROM s_area_list_c
        ORDER BY constellation_key, s_area
        """,
    )

    lines_by_constellation = {}
    for row in line_rows:
        constellation_key = row["constellation_key"]
        line_no = row["line_no"]
        lines_by_constellation.setdefault(constellation_key, {}).setdefault(line_no, []).append(to_star_key(row["hipparcos"], "hipparcos"))

    areas_by_constellation = {}
    for row in area_rows:
        code = s_area_to_aynu_code(row["s_area"])
        if code:
            areas_by_constellation.setdefault(row["constellation_key"], []).append(code)

    constellations = []
    for row in culture_rows:
        constellation_key = row["constellation_key"]
        line_groups = lines_by_constellation.get(constellation_key, {})
        lines = [points for _, points in sorted(line_groups.items()) if points]
        aynu = areas_by_constellation.get(constellation_key, [])
        description = row["meaning"] or row["original_meaning"] or row["memo"] or ""

        constellations.append(
            {
                "key": str(row["star_culture_id"]),
                "ra": to_float(row["ra"]),
                "dec": to_float(row["dec"]),
                "name": row["name_ja"] or "",
                "description": description,
                "lines": lines,
                "aynu": aynu,
            }
        )

    return constellations


def build_city_map(city_list):
    city_map = {}
    if not isinstance(city_list, list):
        return city_map

    for item in city_list:
        if not isinstance(item, dict) or not item.get("city"):
            continue

        area_keys = aynu_codes_to_area_keys(item.get("aynu"))
        entry = {
            "forecast": item.get("forecast"),
            "region": item.get("area"),
            "bureau": item.get("subprefecture"),
            "lat": to_float(item.get("lat")),
            "lon": to_float(item.get("lon")),
        }
        if len(area_keys) > 1:
            entry["areas"] = area_keys
        elif len(area_keys) == 1:
            entry["area"] = area_keys[0]

        city_map[str(item["city"])] = entry

    return city_map


def fetch_city_map(conn):
    exact_tables = {
        "present_area_master": get_table_columns(conn, "present_area_master"),
        "s_area_list_p": get_table_columns(conn, "s_area_list_p"),
    }
    if all(exact_tables.values()):
        return fetch_city_map_from_ddl(conn) or load_fallback_city_map()

    table, columns = find_table(conn, ("city", "cities", "municipality", "municipalities"))
    if not table:
        return load_fallback_city_map()

    city_column = first_column(columns, ("city", "name", "name_ja", "municipality"))
    forecast_column = first_column(columns, ("forecast", "forecast_area"))
    region_column = first_column(columns, ("area", "region"))
    bureau_column = first_column(columns, ("subprefecture", "bureau", "district"))
    lat_column = first_column(columns, ("lat", "latitude"))
    lon_column = first_column(columns, ("lon", "lng", "longitude"))
    aynu_column = first_column(columns, ("aynu", "aynu_codes", "culture_areas", "area_codes"))
    area_key_column = first_column(columns, ("area_key", "area_keys"))

    if not city_column:
        return load_fallback_city_map()

    if not aynu_column and not area_key_column:
        return load_fallback_city_map()

    selected_columns = [
        column
        for column in (
            city_column,
            forecast_column,
            region_column,
            bureau_column,
            lat_column,
            lon_column,
            aynu_column,
            area_key_column,
        )
        if column
    ]
    rows = select_rows(conn, table, columns, selected_columns, order_column=city_column)

    city_map = {}
    for row in rows:
        city_name = row.get(city_column)
        if not city_name:
            continue

        area_keys = parse_json_value(row.get(area_key_column), []) if area_key_column else aynu_codes_to_area_keys(row.get(aynu_column))
        if isinstance(area_keys, str):
            area_keys = [area_keys]

        entry = {
            "forecast": row.get(forecast_column) if forecast_column else None,
            "region": row.get(region_column) if region_column else None,
            "bureau": row.get(bureau_column) if bureau_column else None,
            "lat": to_float(row.get(lat_column)) if lat_column else None,
            "lon": to_float(row.get(lon_column)) if lon_column else None,
        }
        if len(area_keys) > 1:
            entry["areas"] = area_keys
        elif len(area_keys) == 1:
            entry["area"] = area_keys[0]

        city_map[str(city_name)] = entry

    return city_map or load_fallback_city_map()


def fetch_city_map_from_ddl(conn):
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
            s.s_area
        FROM present_area_master p
        LEFT JOIN s_area_list_p s
          ON s.city = p.city
        ORDER BY p.city, s.s_area
        """,
    )

    city_map = {}
    for row in rows:
        city = row["city"]
        entry = city_map.setdefault(
            city,
            {
                "forecast": row["forecast"],
                "region": row["area"],
                "bureau": row["subprefecture"],
                "lat": to_float(row["lat"]),
                "lon": to_float(row["lon"]),
            },
        )

        area_key = None
        code = s_area_to_aynu_code(row["s_area"])
        if code:
            area_key = aynu_codes_to_area_keys([code])[0]

        if not area_key:
            continue

        if "area" not in entry and "areas" not in entry:
            entry["area"] = area_key
        elif entry.get("area") and entry["area"] != area_key:
            entry["areas"] = [entry.pop("area"), area_key]
        elif "areas" in entry and area_key not in entry["areas"]:
            entry["areas"].append(area_key)

    return city_map


@application.route("/")
def index():
    return send_from_directory(ROOT_DIR, "index.html")


@application.route("/api/health")
def health():
    return jsonify({"ok": True})


@application.route("/api/star-cultures")
def get_star_cultures():
    try:
        with get_conn() as conn:
            return jsonify(
                {
                    "stars": fetch_stars(conn),
                    "constellations": fetch_constellations(conn),
                    "cityMap": fetch_city_map(conn),
                }
            )
    except DataShapeError as exc:
        return jsonify({"error": str(exc)}), 500
    except KeyError as exc:
        if use_file_fallback():
            return jsonify(
                {
                    "stars": load_fallback_stars(),
                    "constellations": load_fallback_constellations(),
                    "cityMap": load_fallback_city_map(),
                }
            )
        return jsonify({"error": f"Missing required environment variable: {exc.args[0]}"}), 500
    except (OSError, json.JSONDecodeError) as exc:
        return jsonify({"error": "Fallback data could not be loaded", "detail": str(exc)}), 500
    except psycopg2.Error as exc:
        return jsonify({"error": "Database query failed", "detail": str(exc)}), 500


@application.route("/<path:path>")
def static_files(path):
    target = ROOT_DIR / path
    if target.is_file():
        return send_from_directory(ROOT_DIR, path)
    return send_from_directory(ROOT_DIR, "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    application.run(host="0.0.0.0", port=port)
