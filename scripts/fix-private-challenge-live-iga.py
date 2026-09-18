from pathlib import Path

handler = Path('api/_handlers/private-challenges.ts')
text = handler.read_text()

old = """    const membersSnap = await db.collection('private_challenge_members').where('challengeId', '==', challengeId).get();
    const isLegacyMoneyChallenge = typeof cData.entryFee === 'number' && cData.entryFee > 0;
    const scoreStart = new Date(cData.startDate || cData.createdAt || nowISO);
    const scoreEnd = new Date(cData.endDate || nowISO);
    const members = await Promise.all(membersSnap.docs.map(async mDoc => {
      const m = mDoc.data();
      let points = Math.max(0, Number(m.points) || 0);
      let workoutsCount = Math.max(0, Number(m.workoutsCount) || 0);
      if (!isLegacyMoneyChallenge && Number.isFinite(scoreStart.getTime()) && Number.isFinite(scoreEnd.getTime())) {
        const iga = await computePrivateChallengeIGAForWindow(m.userId, scoreStart, scoreEnd);
        points = Number(Math.max(0, Number(iga.average) || 0).toFixed(6));
        workoutsCount = iga.weeks.reduce((sum, week) => sum + Math.max(0, Number(week.frequency) || 0), 0);
      }
      return {
        userId: m.userId,
        userName: m.userName || 'Atleta',
        userPhoto: m.userPhoto || '',
        points,
        igaScore: isLegacyMoneyChallenge ? null : points,
        workoutsCount,
        joinedAt: m.joinedAt,
        stakePaid: Math.max(0, Number(m.stakeAmount) || 0),
      };
    }));
    members.sort((a, b) => b.points - a.points || String(a.userId).localeCompare(String(b.userId)));

    const isCurrentUserMember = members.some(m => m.userId === userId);
    if (!isCreator && !isCurrentUserMember) continue;
"""

new = """    const membersSnap = await db.collection('private_challenge_members').where('challengeId', '==', challengeId).get();
    const rawMembers = membersSnap.docs.map(mDoc => mDoc.data());
    const isCurrentUserMember = rawMembers.some(m => m.userId === userId);
    if (!isCreator && !isCurrentUserMember) continue;

    const isLegacyMoneyChallenge = typeof cData.entryFee === 'number' && cData.entryFee > 0;
    const scoreStart = new Date(cData.startDate || cData.createdAt || nowISO);
    const configuredScoreEnd = new Date(cData.endDate || nowISO);
    const nowMs = Date.parse(nowISO);
    const scoreEnd = ['forming', 'active'].includes(cData.status) && Number.isFinite(configuredScoreEnd.getTime())
      ? new Date(Math.min(configuredScoreEnd.getTime(), nowMs))
      : configuredScoreEnd;
    const members = await Promise.all(rawMembers.map(async m => {
      let points = Math.max(0, Number(m.points) || 0);
      let workoutsCount = Math.max(0, Number(m.workoutsCount) || 0);
      if (!isLegacyMoneyChallenge && Number.isFinite(scoreStart.getTime()) && Number.isFinite(scoreEnd.getTime())) {
        const iga = await computePrivateChallengeIGAForWindow(m.userId, scoreStart, scoreEnd);
        points = Number(Math.max(0, Number(iga.average) || 0).toFixed(6));
        workoutsCount = iga.weeks.reduce((sum, week) => sum + Math.max(0, Number(week.frequency) || 0), 0);
      }
      return {
        userId: m.userId,
        userName: m.userName || 'Atleta',
        userPhoto: m.userPhoto || '',
        points,
        igaScore: isLegacyMoneyChallenge ? null : points,
        workoutsCount,
        joinedAt: m.joinedAt,
        stakePaid: Math.max(0, Number(m.stakeAmount) || 0),
      };
    }));
    members.sort((a, b) => b.points - a.points || String(a.userId).localeCompare(String(b.userId)));
"""

if old not in text:
    raise SystemExit('optimized live ranking block not found')
text = text.replace(old, new, 1)
handler.write_text(text)

test = Path('api/__tests__/private-challenge-staking-live-contract.test.ts')
test_text = test.read_text()

active_anchor = """    expect(result.body.challenges[0].members[0]).toMatchObject({ userId: 'u2', points: 9.25, igaScore: 9.25, workoutsCount: 4 });
    expect(result.body.challenges[0].members[1]).toMatchObject({ userId: 'u1', points: 6.5, igaScore: 6.5, workoutsCount: 3 });
  });
"""
active_replacement = """    expect(result.body.challenges[0].members[0]).toMatchObject({ userId: 'u2', points: 9.25, igaScore: 9.25, workoutsCount: 4 });
    expect(result.body.challenges[0].members[1]).toMatchObject({ userId: 'u1', points: 6.5, igaScore: 6.5, workoutsCount: 3 });
    const scoreEnds = (computePrivateChallengeIGAForWindow as jest.Mock).mock.calls.map(call => (call[2] as Date).toISOString());
    expect(scoreEnds.length).toBeGreaterThan(0);
    expect(scoreEnds.every(end => end === now)).toBe(true);
  });
"""
if 'const scoreEnds =' not in test_text:
    if active_anchor not in test_text:
        raise SystemExit('active IGA test anchor not found')
    test_text = test_text.replace(active_anchor, active_replacement, 1)

if 'não calcula IGA de desafio privado de terceiro' not in test_text:
    insert = r'''

  test('não calcula IGA de desafio privado de terceiro', async () => {
    records.set('private_challenges/ch-hidden', {
      title: 'Privado de terceiro', creatorId: 'u2', creatorName: 'Atleta 2', status: 'active', stakeAmount: 0, potTotal: 0,
      createdAt: '2026-09-10T00:00:00.000Z', startDate: '2026-09-10T00:00:00.000Z', endDate: '2026-09-25T00:00:00.000Z', extendedOnce: false,
    });
    member('ch-hidden', 'u2', 0);
    (computePrivateChallengeIGAForWindow as jest.Mock).mockClear();

    const result = await request({ action: 'list' });
    expect(result.status).toBe(200);
    expect(result.body.challenges).toEqual([]);
    expect(computePrivateChallengeIGAForWindow).not.toHaveBeenCalled();
  });
'''
    marker = '\n});\n'
    head, tail = test_text.rsplit(marker, 1)
    test_text = head + insert + marker + tail

test.write_text(test_text)
