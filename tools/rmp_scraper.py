#!/usr/bin/env python3
"""RateMyProfessors professor-list harvest for one school.

Matches the public RateMyProfScraper(schoolid) API used by
Rodantny/Rate-My-Professor-Scraper-and-Search:

    URochester = RateMyProfScraper(1331)

The old /filter/professor JSON listing is tried first. RateMyProfessors now
serves the same directory over GraphQL, so that is the fallback. This harvests
the professor directory (name, department, aggregate ratings) — the same
records the classic scraper returned — not every individual student comment.

Usage:
  python3 tools/rmp_scraper.py 1331
  python3 tools/rmp_scraper.py            # defaults to University of Rochester
"""
from __future__ import annotations

import base64
import json
import math
import os
import subprocess
import sys
import tempfile
import time
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, '..', 'data-src')
GRAPHQL = 'https://www.ratemyprofessors.com/graphql'
CLASSIC = (
    'https://www.ratemyprofessors.com/filter/professor/'
    '?&page={page}&filter=teacherlastname_sort_s+asc'
    '&query=*%3A*&queryoption=TEACHER&queryBy=schoolId&sid={sid}'
)
# Same Basic token the RateMyProfessors web app puts in REACT_APP_GRAPHQL_AUTH.
GRAPHQL_AUTH = 'Basic ' + base64.b64encode(b'test:test').decode()

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    ),
    'Accept': 'application/json',
}

TEACHERS_QUERY = """
query TeacherSearchPagination($query: TeacherSearchQuery!, $count: Int!, $cursor: String) {
  search: newSearch {
    teachers(query: $query, first: $count, after: $cursor) {
      resultCount
      pageInfo { hasNextPage endCursor }
      edges {
        cursor
        node {
          id
          legacyId
          firstName
          lastName
          department
          avgRating
          numRatings
          avgDifficulty
          wouldTakeAgainPercent
          school { name id legacyId }
        }
      }
    }
  }
}
"""

SCHOOL_QUERY = """
query School($id: ID!) {
  node(id: $id) {
    __typename
    ... on School {
      id
      legacyId
      name
      city
      state
    }
  }
}
"""


def school_graphql_id(school_id: int) -> str:
    return base64.b64encode(f'School-{int(school_id)}'.encode()).decode()


def curl(args, timeout=60):
    r = subprocess.run(
        ['curl', '-sL', '--max-time', str(timeout), '-w', '\n%{http_code}'] + args,
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or f'curl failed ({r.returncode})')
    body, _, code = r.stdout.rpartition('\n')
    if code not in ('200', '201'):
        raise RuntimeError(f'HTTP {code}: {body[:300]}')
    return body


def http_json(url, payload=None, extra_headers=None):
    args = ['-H', f'User-Agent: {HEADERS["User-Agent"]}', '-H', 'Accept: application/json']
    if extra_headers:
        for k, v in extra_headers.items():
            args += ['-H', f'{k}: {v}']
    tmp = None
    try:
        if payload is not None:
            tmp = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False)
            json.dump(payload, tmp)
            tmp.close()
            args += ['-H', 'Content-Type: application/json', '--data-binary', f'@{tmp.name}']
        args.append(url)
        raw = curl(args)
    finally:
        if tmp:
            os.unlink(tmp.name)
    return json.loads(raw)


def graphql(query, variables):
    body = http_json(
        GRAPHQL,
        {'query': query, 'variables': variables},
        {'Authorization': GRAPHQL_AUTH},
    )
    if body.get('errors'):
        raise RuntimeError(body['errors'])
    return body['data']


def node_to_classic(node):
    """Shape each GraphQL teacher like the classic /filter/professor records."""
    school = node.get('school') or {}
    rating = node.get('avgRating')
    return {
        'tDept': node.get('department') or '',
        'tSid': str(school.get('legacyId') or ''),
        'institution_name': school.get('name') or '',
        'tFname': node.get('firstName') or '',
        'tMiddlename': '',
        'tLname': node.get('lastName') or '',
        'tid': node.get('legacyId'),
        'tNumRatings': node.get('numRatings') or 0,
        'overall_rating': '' if rating in (None, 0) and not node.get('numRatings') else (
            '' if rating is None else str(rating)
        ),
        'avgDifficulty': node.get('avgDifficulty'),
        'wouldTakeAgainPercent': node.get('wouldTakeAgainPercent'),
        'graphqlId': node.get('id'),
    }


class RateMyProfScraper:
    def __init__(self, schoolid):
        self.UniversityId = int(schoolid)
        self.school = self._school()
        self.professorlist = self.createprofessorlist()
        self.indexnumber = False

    def _school(self):
        try:
            data = graphql(SCHOOL_QUERY, {'id': school_graphql_id(self.UniversityId)})
            node = data.get('node') or {}
            if node.get('__typename') == 'School':
                return {
                    'id': self.UniversityId,
                    'name': node.get('name'),
                    'city': node.get('city'),
                    'state': node.get('state'),
                    'graphqlId': node.get('id'),
                }
        except Exception as e:
            print(f'warning: school lookup failed ({e})', file=sys.stderr)
        return {'id': self.UniversityId, 'name': None, 'city': None, 'state': None}

    def createprofessorlist(self):
        classic = self._classic_list()
        if classic:
            print(f'classic /filter/professor returned {len(classic)} professors')
            return classic
        print('classic listing unavailable; using GraphQL directory')
        return self._graphql_list()

    def _classic_list(self):
        try:
            payload = http_json(CLASSIC.format(page=1, sid=self.UniversityId))
            if 'professors' not in payload:
                return None
            total = payload.get('searchResultsTotal') or (payload.get('remaining', 0) + len(payload['professors']))
            out = list(payload['professors'])
            pages = max(1, math.ceil(total / 20))
            for page in range(2, pages + 1):
                chunk = http_json(CLASSIC.format(page=page, sid=self.UniversityId))
                out.extend(chunk.get('professors') or [])
                time.sleep(0.15)
            return out
        except (ValueError, RuntimeError, json.JSONDecodeError):
            return None

    def _graphql_list(self):
        school_id = school_graphql_id(self.UniversityId)
        cursor = None
        out = []
        seen = set()
        while True:
            data = graphql(TEACHERS_QUERY, {
                'query': {'text': '', 'schoolID': school_id, 'fallback': True},
                'count': 100,
                'cursor': cursor,
            })
            block = ((data.get('search') or {}).get('teachers')) or {}
            edges = block.get('edges') or []
            for edge in edges:
                node = (edge or {}).get('node') or {}
                tid = node.get('legacyId')
                if tid is None or tid in seen:
                    continue
                seen.add(tid)
                out.append(node_to_classic(node))
            page = block.get('pageInfo') or {}
            print(f'  {len(out)} / {block.get("resultCount") or "?"} professors')
            if not page.get('hasNextPage') or not page.get('endCursor'):
                break
            cursor = page['endCursor']
            time.sleep(0.2)
        return out

    def SearchProfessor(self, ProfessorName):
        self.indexnumber = self.GetProfessorIndex(ProfessorName)
        self.PrintProfessorInfo()
        return self.indexnumber

    def GetProfessorIndex(self, ProfessorName):
        want = ' '.join(ProfessorName.split()).casefold()
        for i, p in enumerate(self.professorlist):
            name = f"{p.get('tFname', '')} {p.get('tLname', '')}".strip()
            if name.casefold() == want:
                return i
        return False

    def PrintProfessorInfo(self):
        if self.indexnumber is False:
            print('error')
        else:
            print(self.professorlist[self.indexnumber])

    def PrintProfessorDetail(self, key):
        if self.indexnumber is False:
            print('error')
            return 'error'
        print(self.professorlist[self.indexnumber][key])
        return self.professorlist[self.indexnumber][key]


def main(argv):
    sid = int(argv[1]) if len(argv) > 1 else 1331
    scraper = RateMyProfScraper(sid)
    school = scraper.school or {}
    name = school.get('name') or f'school {sid}'
    print(f'{name}: {len(scraper.professorlist)} professors')
    os.makedirs(OUT_DIR, exist_ok=True)
    slug = name.lower().replace(' ', '-') if school.get('name') else f'school-{sid}'
    out_path = os.path.join(OUT_DIR, f'rmp-{slug}.json')
    payload = {
        'source': 'RateMyProfessors professor directory',
        'sourceUrl': f'https://www.ratemyprofessors.com/search/professors/{sid}?q=*',
        'schoolId': sid,
        'school': school,
        'sourcedOn': date.today().isoformat(),
        'count': len(scraper.professorlist),
        'professors': scraper.professorlist,
    }
    with open(out_path, 'w') as f:
        json.dump(payload, f, indent=2)
        f.write('\n')
    print(f'wrote {out_path}')
    bundled = os.path.join(HERE, '..', 'src', 'data', 'rmp.json')
    compact = {
        'source': payload['source'],
        'sourceUrl': payload['sourceUrl'],
        'schoolId': sid,
        'schoolName': school.get('name') or 'University of Rochester',
        'sourcedOn': payload['sourcedOn'],
        'professors': [],
    }
    for p in scraper.professorlist:
        rating = p.get('overall_rating')
        try:
            rating = float(rating) if rating not in ('', None) else None
        except (TypeError, ValueError):
            rating = None
        wta = p.get('wouldTakeAgainPercent')
        if wta is not None and wta < 0:
            wta = None
        diff = p.get('avgDifficulty')
        compact['professors'].append({
            'first': (p.get('tFname') or '').strip(),
            'last': (p.get('tLname') or '').strip(),
            'dept': (p.get('tDept') or '').strip(),
            'rating': rating,
            'difficulty': None if diff in ('', None) else diff,
            'wouldTakeAgain': wta,
            'numRatings': int(p.get('tNumRatings') or 0),
            'id': p.get('tid'),
        })
    os.makedirs(os.path.dirname(bundled), exist_ok=True)
    with open(bundled, 'w') as f:
        json.dump(compact, f, separators=(',', ':'))
        f.write('\n')
    print(f'wrote {bundled}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
