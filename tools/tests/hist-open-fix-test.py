#!/usr/bin/env python3
"""Synthetic session: the first minute (23:00 UTC) is missing from the tick rows; the vendor has it. The open must be that bar's OPEN."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'hist'))
from fix_opens import patch_opens

T0 = 1795388400                      # Sun 2026-11-22 23:00 UTC = 18:00 New York
V = {T0 + 60 * i: [T0 + 60 * i, 100 + i, 105 + i, 99 + i, 101 + i, 50] for i in range(6)}   # sample data
ticks = [[T0 + 60, 102.5, 106, 100, 102, 7, 3, 4], [T0 + 120, 102, 107, 101, 103, 60, 30, 9]]   # first tick bar is a part-minute
rows, n = patch_opens(ticks, V)
assert n == 1 and rows[0][0] == T0 and rows[0][1] == 100, rows       # open of the session = first bar's open
assert rows[1][0] == T0 + 60 and rows[1][1] == 101 and rows[1][5] == 50   # part-minute replaced by the full vendor minute
assert rows[2] == ticks[1], rows                                     # later tick bars untouched
again, n2 = patch_opens(rows, V)
assert n2 == 0 and again == rows                                     # idempotent
assert patch_opens(ticks, {})[1] == 0                                # vendor has nothing: nothing invented
late = [[T0 + 3600, 1, 2, 1, 2, 1, 0, 0]]
assert patch_opens(late, V)[1] == 0                                  # a long hole is left alone
mid = {T0 + 60 * i: [T0 + 60 * i, 1, 2, 1, 2, 1] for i in range(6)}
assert patch_opens([[T0 + 3600 * 2 + 60, 1, 2, 1, 2, 1, 0, 0]], {T0 + 3600 * 2: [T0 + 7200, 1, 2, 1, 2, 1], T0 + 7200 - 60: [T0 + 7140, 1, 2, 1, 2, 1]})[1] == 0   # vendor bar a minute earlier = mid-session, not an open
print('hist-open-fix-test OK')
