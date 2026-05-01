from __future__ import annotations

import json
import mimetypes
import os
from decimal import Decimal
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PORT = 8000


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


def load_dotenv(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def decimal_to_float(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    return value


def s_area_to_ainu_code(value: Any) -> Optional[str]:
    text = "" if value is None else str(value).strip()
    if text in {"1", "2", "3", "4", "5"}:
        return f"ainu{text}"
    if text in {"ainu1", "ainu2", "ainu3", "ainu4", "ainu5"}:
        return text
    return None


def s_area_to_area_key(value: Any) -> Optional[str]:
    code = s_area_to_ainu_code(value)
    return f"area{code[-1]}" if code else None


def db_connect():
    load_dotenv()

    try:
        import psycopg
        from psycopg.rows import dict_row
    except ModuleNotFoundError as exc:
        raise ApiError(
            HTTPStatus.INTERNAL_SERVER_ERROR,
            "PostgreSQLドライバが見つかりません。`python3 -m pip install -r api/requirements.txt` を実行してください。",
        ) from exc

    conninfo = os.environ.get("DATABASE_URL")
    kwargs: dict[str, Any] = {"row_factory": dict_row}
    if conninfo:
        return psycopg.connect(conninfo, **kwargs)

    params = {
        "host": os.environ.get("RDSHOST") or os.environ.get("PGHOST"),
        "port": os.environ.get("PGPORT", "5432"),
        "dbname": os.environ.get("PGDATABASE", "stella"),
        "user": os.environ.get("PGUSER", "postgres"),
        "password": os.environ.get("PGPASSWORD"),
        "sslmode": os.environ.get("PGSSLMODE", "verify-full"),
        "sslrootcert": os.environ.get("PGSSLROOTCERT", str(ROOT / "global-bundle.pem")),
    }
    if not params["host"]:
        raise ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, "RDSHOST または PGHOST が未設定です。")

    return psycopg.connect(**{k: v for k, v in params.items() if v}, **kwargs)


def fetch_ainu_data() -> dict[str, Any]:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select hipparcos, ra, dec
                  from public.star_master
                 order by hipparcos
                """
            )
            stars = {
                row["hipparcos"]: {
                    "ra": decimal_to_float(row["ra"]),
                    "dec": decimal_to_float(row["dec"]),
                }
                for row in cur.fetchall()
            }

            cur.execute(
                """
                select distinct on (cl.constellation_key)
                       cl.constellation_key,
                       cl.ra,
                       cl.dec,
                       sc.name_ja,
                       sc.meaning
                  from public.constellation_list cl
                  join public.star_culture sc
                    on sc.constellation_key = cl.constellation_key
                 where cl.is_published = true
                   and sc.is_published = true
                 order by cl.constellation_key, sc.star_culture_id
                """
            )
            constellations = {
                row["constellation_key"]: {
                    "key": row["constellation_key"],
                    "ra": decimal_to_float(row["ra"]),
                    "dec": decimal_to_float(row["dec"]),
                    "name": row["name_ja"],
                    "description": row["meaning"] or "",
                    "lines": [],
                    "ainu": [],
                }
                for row in cur.fetchall()
            }

            cur.execute(
                """
                select constellation_key, line_no, point_no, hipparcos
                  from public.constellation_line_list
                 order by constellation_key, line_no, point_no
                """
            )
            current_key = None
            current_line_no = None
            current_line: list[str] = []
            for row in cur.fetchall():
                key = row["constellation_key"]
                if key not in constellations:
                    continue
                line_no = row["line_no"]
                if current_key != key or current_line_no != line_no:
                    if current_key in constellations and current_line:
                        constellations[current_key]["lines"].append(current_line)
                    current_key = key
                    current_line_no = line_no
                    current_line = []
                current_line.append(row["hipparcos"])
            if current_key in constellations and current_line:
                constellations[current_key]["lines"].append(current_line)

            cur.execute(
                """
                select constellation_key, s_area
                  from public.s_area_list_c
                 order by constellation_key, s_area
                """
            )
            for row in cur.fetchall():
                item = constellations.get(row["constellation_key"])
                code = s_area_to_ainu_code(row["s_area"])
                if item is not None and code:
                    item["ainu"].append(code)

            cur.execute(
                """
                select p.city,
                       p.forecast,
                       p.area,
                       p.subprefecture,
                       p.lat,
                       p.lon,
                       sp.s_area
                  from public.present_area_master p
                  left join public.s_area_list_p sp
                    on sp.city = p.city
                 order by p.city, sp.s_area
                """
            )
            city_map: dict[str, dict[str, Any]] = {}
            for row in cur.fetchall():
                city = row["city"]
                entry = city_map.setdefault(
                    city,
                    {
                        "forecast": row["forecast"],
                        "region": row["area"],
                        "bureau": row["subprefecture"],
                        "lat": decimal_to_float(row["lat"]),
                        "lon": decimal_to_float(row["lon"]),
                    },
                )
                area_key = s_area_to_area_key(row["s_area"])
                if not area_key:
                    continue
                areas = entry.setdefault("areas", [])
                if area_key not in areas:
                    areas.append(area_key)

            for entry in city_map.values():
                areas = entry.get("areas")
                if isinstance(areas, list) and len(areas) == 1:
                    entry["area"] = areas[0]
                    del entry["areas"]

    return {
        "stars": stars,
        "constellations": list(constellations.values()),
        "cityMap": city_map,
    }


class StellaHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/ainu-data":
            self.handle_ainu_data()
            return
        if path == "/":
            self.path = "/index.html"
        super().do_GET()

    def handle_ainu_data(self):
        try:
            payload = fetch_ainu_data()
            self.send_json(HTTPStatus.OK, payload)
        except ApiError as exc:
            self.send_json(exc.status, {"error": exc.message})
        except Exception as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def send_json(self, status: int, payload: Any):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    load_dotenv()
    mimetypes.add_type("text/javascript; charset=utf-8", ".js")
    port = int(os.environ.get("PORT", str(DEFAULT_PORT)))
    host = os.environ.get("HOST", "0.0.0.0")
    server = ThreadingHTTPServer((host, port), StellaHandler)
    print(f"Serving Stella Ainu viewer at http://{host}:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
