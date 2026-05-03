#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
SEED_FILE = DATA / 'seed_jobs.json'
JOBS_FILE = DATA / 'jobs.json'
META_FILE = DATA / 'metadata.json'

SOURCES = [
    {'name': 'jobs.ch Luzern Praktikum Administration', 'url': 'https://www.jobs.ch/de/stellenangebote/?location=luzern&term=praktikum%20administration'},
    {'name': 'jobs.ch Zug Praktikum Administration', 'url': 'https://www.jobs.ch/de/stellenangebote/?location=zug&term=praktikum%20administration'},
    {'name': 'jobs.ch Luzern Praktikum', 'url': 'https://www.jobs.ch/de/stellenangebote/?location=luzern&term=praktikum'},
    {'name': 'jobs.ch Zug Praktikum', 'url': 'https://www.jobs.ch/de/stellenangebote/?location=zug&term=praktikum'},
    {'name': 'Kanton Zug Jobs', 'url': 'https://www.zg.ch/jobs/offene-stellen'},
    {'name': 'CH Media Jobs', 'url': 'https://chmedia.ch/jobs/'},
]

LOCATIONS_LU = {'luzern','lucerne','kriens','emmen','sursee','hochdorf','willisau','nottwil','weggis','horw','ebikon','6000','6002','6003','6004','6005','6010'}
LOCATIONS_ZG = {'zug','baar','cham','rotkreuz','risch','steinhausen','hünenberg','huenenberg','menzingen','unterägeri','unteraegeri','oberägeri','oberaegeri','walchwil','6300','6312','6340','6343','6331'}
DOMAIN_KEYWORDS = ['praktikum','praktikant','praktikantin','trainee','internship','pwa','jahrespraktikant','kv-praktikum','hms']
FIELD_KEYWORDS = ['administration','admin','kaufm','kauffrau','kaufmann','dienstleistung','service','office','assistenz','sekretariat','hr','personal','recruit','sales support','backoffice','verwaltung','marketing','kommunikation','kundendienst','empfang','sachbearbeitung']
TOO_LATE_TERMS = ['september 2026','17.09.2026','herbst 2026','oktober 2026','november 2026','dezember 2026']
WARNING_TERMS = ['17. august 2026','17.08.2026','mitte august','ende august']
GOOD_START_TERMS = ['per sofort','nach vereinbarung','sommer 2026','1. mai 2026','1. juni 2026','1. juli 2026','juli 2026','anfang august','1. august 2026','01.08.2026']
CITY_COORDS = {
    'luzern': (47.0502, 8.3093, 'Luzern'), 'lucerne': (47.0502, 8.3093, 'Luzern'), 'kriens': (47.0354, 8.2800, 'Kriens'),
    'emmen': (47.0782, 8.2736, 'Emmen'), 'sursee': (47.1717, 8.1111, 'Sursee'), 'hochdorf': (47.1687, 8.2924, 'Hochdorf'),
    'zug': (47.1662, 8.5155, 'Zug'), 'baar': (47.1963, 8.5295, 'Baar'), 'cham': (47.1821, 8.4636, 'Cham'),
    'rotkreuz': (47.1420, 8.4310, 'Rotkreuz'), 'risch': (47.1290, 8.4300, 'Risch'), 'steinhausen': (47.1951, 8.4855, 'Steinhausen'),
    'hünenberg': (47.1742, 8.4261, 'Hünenberg'), 'huenenberg': (47.1742, 8.4261, 'Hünenberg'), 'menzingen': (47.1788, 8.5919, 'Menzingen'),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')


def norm(value: Any) -> str:
    text = html.unescape(str(value or ''))
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def fingerprint(*parts: str) -> str:
    raw = '|'.join(norm(p).lower() for p in parts)
    return hashlib.sha1(raw.encode('utf-8')).hexdigest()[:14]


def detect_canton(text: str) -> Optional[str]:
    low = text.lower()
    if 'zug/luzern' in low or 'luzern/zug' in low:
        return 'ZG/LU'
    if any(token in low for token in LOCATIONS_ZG):
        return 'ZG'
    if any(token in low for token in LOCATIONS_LU):
        return 'LU'
    return None


def is_relevant(text: str) -> bool:
    low = text.lower()
    return any(k in low for k in DOMAIN_KEYWORDS) and any(k in low for k in FIELD_KEYWORDS)


def infer_suitability(text: str) -> Tuple[str, str]:
    low = text.lower()
    if any(t in low for t in TOO_LATE_TERMS):
        return 'zu_spaet', 'Start gemäss Text vermutlich nach Anfang August 2026.'
    if any(t in low for t in WARNING_TERMS):
        return 'knapp', 'Start liegt eher Mitte/zweite Augusthälfte 2026; mit Vorgabe abgleichen.'
    if any(t in low for t in GOOD_START_TERMS):
        return 'passend', 'Start liegt vor oder ungefähr zu Anfang August 2026.'
    return 'prüfen', 'Startdatum wurde automatisch nicht eindeutig erkannt.'


def coords(job: Dict[str, Any]) -> Dict[str, Any]:
    low = ' '.join(str(job.get(k, '')) for k in ('location','company','title','canton')).lower()
    for key, (lat, lng, label) in CITY_COORDS.items():
        if key in low:
            return {'map_lat': lat, 'map_lng': lng, 'map_label': label}
    if job.get('canton') == 'LU':
        return {'map_lat': 47.0502, 'map_lng': 8.3093, 'map_label': 'Luzern'}
    if job.get('canton') == 'ZG':
        return {'map_lat': 47.1662, 'map_lng': 8.5155, 'map_label': 'Zug'}
    if job.get('canton') == 'ZG/LU':
        return {'map_lat': 47.1082, 'map_lng': 8.4124, 'map_label': 'Zug / Luzern'}
    return {'map_lat': None, 'map_lng': None, 'map_label': job.get('location') or 'Standort prüfen'}


def score(job: Dict[str, Any]) -> Dict[str, Any]:
    if 'desirability_score' in job and 'desirability_factors' in job:
        return job
    blob = ' '.join(str(job.get(k, '')) for k in ('title','company','location','field','workload','start','duration','match_reason','company_info')).lower()
    value = 20
    value += {'passend': 26, 'prüfen': 16, 'knapp': 8, 'zu_spaet': -24}.get(job.get('suitability'), 12)
    value += {'hoch': 10, 'mittel': 7, 'niedrig': 3}.get(str(job.get('confidence','mittel')).lower(), 6)
    if any(k in blob for k in ['kanton','stadt','hochschule','bank','versicherung','siemens','ch media','concordia','hslu']):
        value += 10
    if any(k in blob for k in FIELD_KEYWORDS):
        value += 10
    if '100' in str(job.get('workload','')):
        value += 6
    if '12' in str(job.get('duration','')).lower() or 'jahr' in str(job.get('duration','')).lower():
        value += 6
    if job.get('canton') in {'LU','ZG','ZG/LU'}:
        value += 5
    value = max(0, min(100, int(value)))
    label = 'sehr begehrt' if value >= 76 else 'hoch' if value >= 62 else 'mittel' if value >= 45 else 'niedrig'
    job['desirability_score'] = value
    job['desirability_label'] = label
    job['desirability_factors'] = ['Automatisch aus Starttermin, Profilnähe, Standort und Datenqualität bewertet.']
    job['desirability_explanation'] = 'Schätzwert aus Starttermin, Profilnähe, Arbeitgeber, Pensum, Dauer, Standort, Quelle und Datenqualität.'
    return job


def enrich(job: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(job)
    out.update(coords(out))
    return score(out)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 PraktikumsFinderLUZG/8.0', 'Accept-Language': 'de-CH,de;q=0.9,en;q=0.5'})
    with urllib.request.urlopen(req, timeout=16) as response:
        raw = response.read(2_500_000)
        charset = 'utf-8'
        content_type = response.headers.get('Content-Type', '')
        match = re.search(r'charset=([\w-]+)', content_type)
        if match:
            charset = match.group(1)
    return raw.decode(charset, errors='replace')


def extract_json_ld(page: str, source: Dict[str, str]) -> List[Dict[str, Any]]:
    found: List[Dict[str, Any]] = []
    scripts = re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', page, flags=re.I | re.S)
    for script in scripts:
        try:
            data = json.loads(html.unescape(script.strip()))
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        for item in list(items):
            if isinstance(item, dict) and isinstance(item.get('@graph'), list):
                items.extend(item['@graph'])
            if not isinstance(item, dict) or item.get('@type') not in ('JobPosting', ['JobPosting']):
                continue
            title = norm(item.get('title'))
            org = item.get('hiringOrganization')
            company = norm(org.get('name')) if isinstance(org, dict) else source['name']
            desc = norm(item.get('description'))
            loc = ''
            location = item.get('jobLocation')
            if isinstance(location, list) and location:
                location = location[0]
            if isinstance(location, dict):
                address = location.get('address') or {}
                if isinstance(address, dict):
                    loc = norm(', '.join(str(address.get(k, '')) for k in ('addressLocality','addressRegion','postalCode') if address.get(k)))
            merged = f'{title} {company} {loc} {desc}'
            canton = detect_canton(merged)
            if not title or not canton or not is_relevant(merged):
                continue
            suitability, reason = infer_suitability(merged)
            found.append(enrich({
                'id': 'live-' + fingerprint(title, company, loc), 'title': title, 'company': company, 'location': loc or canton,
                'canton': canton, 'field': 'automatisch erkannt', 'workload': norm(item.get('employmentType') or 'nicht erkannt'),
                'start': 'automatisch prüfen', 'duration': 'nicht erkannt', 'suitability': suitability, 'match_reason': reason,
                'criteria': ['Automatisch gefundener Treffer – Originalinserat prüfen.'], 'tasks': [desc[:240]],
                'company_info': 'Automatisch aus strukturierter JobPosting-Seite erkannt.', 'source': source['name'],
                'source_url': item.get('url') or source['url'], 'last_seen': datetime.now().strftime('%Y-%m-%d'), 'confidence': 'mittel', 'live_found': True
            }))
    return found


def extract_generic(page: str, source: Dict[str, str]) -> List[Dict[str, Any]]:
    found: List[Dict[str, Any]] = []
    for match in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', page, flags=re.I | re.S):
        href, label_html = match.groups()
        label = norm(label_html)
        if len(label) < 8 or len(label) > 140:
            continue
        context = norm(page[max(0, match.start() - 700):min(len(page), match.end() + 1400)])
        merged = f'{label} {context}'
        canton = detect_canton(merged)
        if not canton or not is_relevant(merged):
            continue
        suitability, reason = infer_suitability(merged)
        url = urllib.parse.urljoin(source['url'], html.unescape(href))
        if not url.startswith('https://'):
            continue
        loc_match = re.search(r'\b(600\d\s*Luzern|Luzern|Kriens|Sursee|6300\s*Zug|Zug|Baar|Rotkreuz|Steinhausen|Cham|Hünenberg|Menzingen)\b', merged, flags=re.I)
        location = loc_match.group(0) if loc_match else canton
        workload = re.search(r'\b(\d{2,3}\s*%|\d{2,3}\s*[-–]\s*\d{2,3}\s*%)\b', merged)
        found.append(enrich({
            'id': 'live-' + fingerprint(label, source['name'], location), 'title': label, 'company': source['name'], 'location': location,
            'canton': canton, 'field': 'automatisch erkannt', 'workload': workload.group(0) if workload else 'nicht erkannt',
            'start': 'automatisch prüfen', 'duration': 'nicht erkannt', 'suitability': suitability, 'match_reason': reason,
            'criteria': ['Automatisch gefundener Treffer – Originalinserat prüfen.'], 'tasks': [context[:260]],
            'company_info': 'Automatisch aus Suchresultat erkannt.', 'source': source['name'], 'source_url': url,
            'last_seen': datetime.now().strftime('%Y-%m-%d'), 'confidence': 'niedrig', 'live_found': True
        }))
    return found[:30]


def merge(seed: Iterable[Dict[str, Any]], live: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for job in list(seed) + list(live):
        job = enrich(job)
        key = fingerprint(job.get('title',''), job.get('company',''), job.get('location',''))
        if key not in result or (result[key].get('live_found') and not job.get('live_found')):
            result[key] = job
    jobs = list(result.values())
    jobs.sort(key=lambda j: (-(j.get('desirability_score') or 0), statusOrder(j.get('suitability')), j.get('company','')))
    return jobs


def statusOrder(status: str) -> int:
    return {'passend': 0, 'prüfen': 1, 'knapp': 2, 'zu_spaet': 3}.get(status, 9)


def main() -> int:
    DATA.mkdir(exist_ok=True)
    seed = json.loads(SEED_FILE.read_text(encoding='utf-8'))
    live: List[Dict[str, Any]] = []
    errors: Dict[str, str] = {}
    for source in SOURCES:
        try:
            page = fetch(source['url'])
            live.extend(extract_json_ld(page, source))
            live.extend(extract_generic(page, source))
            time.sleep(1.0)
        except Exception as exc:
            errors[source['name']] = f'{type(exc).__name__}: {exc}'
    jobs = merge(seed, live)
    metadata = {
        'updated_at': now_iso(), 'mode': 'cloud_static_pwa', 'requires_local_pc': False,
        'refresh_interval_seconds': 1800, 'seed_count': len(seed), 'live_count': len(live), 'total_count': len(jobs),
        'sources': SOURCES, 'errors': errors,
        'note': 'Cloud-PWA: Datenaktualisierung über GitHub Actions; keine lokale PC-Serverpflicht.'
    }
    JOBS_FILE.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding='utf-8')
    META_FILE.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    (ROOT / 'app-data.js').write_text('window.PF_BOOTSTRAP_DATA = ' + json.dumps({'jobs': jobs, 'meta': metadata}, ensure_ascii=False) + ';\n', encoding='utf-8')
    print(f'Wrote {len(jobs)} jobs, live={len(live)}, errors={len(errors)}')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
