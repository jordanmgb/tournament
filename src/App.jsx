import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase";

const ORGANISER_PASSWORD = "MaccabiGB";
const MACCABI_SCHOOLS = [
  "Clore Shalom",
  "Clore Tikva",
  "Eden Primary",
  "Etz Chaim",
  "Hasmonean",
  "HJPS",
  "IJDS",
  "Kerem",
  "Menorah Foundation",
  "MMK",
  "Morasha",
  "Naima",
  "Nancy Reuben",
  "North West",
  "Rimon",
  "Rosh Pinah",
  "Sinai",
  "Wolfson Hillel",
  "Yavneh",
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundRobinPairs(teamIds) {
  // Circle method: produces a genuine round-by-round schedule so a team's
  // fixtures are spread across the list rather than clustered at either end.
  // Shuffling the input order first means the same team set produces a
  // different-looking schedule (though every pair still occurs exactly once)
  // each time fixtures are generated.
  let ids = [...teamIds].sort(() => Math.random() - 0.5);
  const hasBye = ids.length % 2 !== 0;
  if (hasBye) ids.push(null);
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  let arr = [...ids];
  const schedule = [];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const t1 = arr[i];
      const t2 = arr[n - 1 - i];
      if (t1 !== null && t2 !== null) {
        schedule.push({ id: uid(), team1: t1, team2: t2, score1: null, score2: null });
      }
    }
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [fixed, ...rest];
  }
  return schedule;
}

function getBaseName(fullName) {
  return fullName.replace(/\s*\((Red|Blue|Green)\)$/, "");
}

function computeStandings(teamIds, fixtures, teamNames) {
  const stats = {};
  teamIds.forEach((id) => {
    stats[id] = { id, name: teamNames[id], played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 };
  });
  fixtures.forEach((f) => {
    if (f.score1 === null || f.score2 === null) return;
    const a = stats[f.team1];
    const b = stats[f.team2];
    if (!a || !b) return;
    a.played++;
    b.played++;
    a.gf += f.score1;
    a.ga += f.score2;
    b.gf += f.score2;
    b.ga += f.score1;
    if (f.score1 > f.score2) {
      a.won++;
      b.lost++;
      a.pts += 3;
    } else if (f.score2 > f.score1) {
      b.won++;
      a.lost++;
      b.pts += 3;
    } else {
      a.drawn++;
      b.drawn++;
      a.pts += 1;
      b.pts += 1;
    }
  });
  const list = Object.values(stats).map((t) => ({ ...t, gd: t.gf - t.ga }));
  list.sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (y.gd !== x.gd) return y.gd - x.gd;
    if (y.gf !== x.gf) return y.gf - x.gf;
    return x.ga - y.ga;
  });
  return list;
}

function seedOrder(qualifiers) {
  return [...qualifiers].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.ga - b.ga;
  });
}

function buildQualifiers(groups, fixtures, teamNames, target) {
  const standingsByGroup = groups.map((g) => computeStandings(g.teamIds, fixtures[g.id] || [], teamNames));
  const n = groups.length;
  let qualifiers = [];

  if (target % n === 0) {
    const perGroup = target / n;
    standingsByGroup.forEach((st) => {
      st.slice(0, perGroup).forEach((t, rank) => qualifiers.push({ ...t, rank: rank + 1 }));
    });
  } else {
    const winners = standingsByGroup.map((st) => ({ ...st[0], rank: 1 }));
    const remaining = target - n;
    const runnersUp = standingsByGroup.map((st) => ({ ...st[1], rank: 2 })).filter(Boolean);
    const rankedRunnersUp = seedOrder(runnersUp).slice(0, remaining);
    qualifiers = [...winners, ...rankedRunnersUp];
  }
  return qualifiers;
}

function makeKnockoutMatch(team1, team2) {
  return {
    id: uid(),
    team1,
    team2,
    score1: null,
    score2: null,
    shootoutWinner: null,
    winner: null,
  };
}

function matchWinner(m) {
  if (m.winner) return m.winner;
  if (m.score1 === null || m.score2 === null) return null;
  if (m.score1 !== m.score2) return m.score1 > m.score2 ? m.team1 : m.team2;
  if (m.shootoutWinner) return m.shootoutWinner;
  return null;
}

function pairKnockoutRound1(qualifiers, pairingMethod) {
  const winners = qualifiers.filter((q) => q.rank === 1);
  const runnersUp = qualifiers.filter((q) => q.rank === 2);
  const crossValid = pairingMethod === "cross" && winners.length === runnersUp.length && winners.length > 0;

  if (crossValid) {
    const matches = [];
    for (let i = 0; i < winners.length; i++) {
      const opp = runnersUp[(i + 1) % runnersUp.length];
      matches.push(makeKnockoutMatch(winners[i].name, opp.name));
    }
    return { matches, usedCross: true };
  }
  const seeded = seedOrder(qualifiers);
  const matches = [];
  for (let i = 0; i < seeded.length / 2; i++) {
    matches.push(makeKnockoutMatch(seeded[i].name, seeded[seeded.length - 1 - i].name));
  }
  return { matches, usedCross: false };
}

function roundLabel(roundIdx, totalRounds) {
  const remaining = totalRounds - roundIdx;
  if (remaining === 1) return "Final";
  if (remaining === 2) return "Semi-final";
  if (remaining === 3) return "Quarter-final";
  return `Round ${roundIdx + 1}`;
}

function simulateKnockoutFull(round1) {
  const rounds = [round1.map((m) => ({ ...m }))];
  let idx = 0;
  while (true) {
    const round = rounds[idx];
    round.forEach((m) => {
      if (m.team2 === "BYE") {
        m.winner = m.team1;
        return;
      }
      m.score1 = Math.floor(Math.random() * 5);
      m.score2 = Math.floor(Math.random() * 5);
      if (m.score1 === m.score2) {
        m.shootoutWinner = Math.random() < 0.5 ? m.team1 : m.team2;
      }
      m.winner = matchWinner(m);
    });
    if (round.length === 1) break;
    const winners = round.map((m) => matchWinner(m));
    const next = [];
    for (let i = 0; i < winners.length; i += 2) {
      next.push(makeKnockoutMatch(winners[i], winners[i + 1] ?? "BYE"));
    }
    rounds.push(next);
    idx++;
  }
  return rounds;
}

function emptyTournamentSetup() {
  return {
    name: "",
    date: "",
    totalTeams: 12,
    numGroups: 2,
    includeKnockout: true,
    qualifyTarget: 4,
    pairingMethod: "seeded",
  };
}

function emptyTournament() {
  return {
    id: uid(),
    name: "Dads Football Tournament",
    date: "",
    structure: "roundRobinKnockout",
    qualifyTarget: 4,
    pairingMethod: "seeded",
    groups: [],
    teamNames: {},
    teamSuffixes: {}, // { teamId: 'Red' or 'Blue' }
    fixtures: {},
    registrations: [],
    schoolTeams: {},
    isLive: false,
    knockout: null,
    greenTournament: null,
    createdAt: new Date().toLocaleDateString("en-GB"),
  };
}

function decideGreenGroupCount(n) {
  // 2 or 3 groups is the normal case, but 6 per group is the hard ceiling —
  // if the Green pool is ever large enough that 3 groups would push a group
  // past 6, scale beyond 3 rather than break the 6-team cap.
  if (n <= 12) return 2;
  if (n <= 18) return 3;
  return Math.ceil(n / 6);
}

function buildGreenTournament(greenTeams) {
  const n = greenTeams.length;
  const numGroups = decideGreenGroupCount(n);
  const groups = Array.from({ length: numGroups }, (_, i) => ({
    id: `green-g${i}`,
    name: `Green Group ${String.fromCharCode(65 + i)}`,
    teamIds: [],
    extraRoundsGenerated: 0,
  }));
  const shuffled = [...greenTeams].sort(() => Math.random() - 0.5);
  const base = Math.floor(n / numGroups);
  const remainder = n % numGroups;
  const capacities = Array.from({ length: numGroups }, (_, i) => base + (i < remainder ? 1 : 0));
  let idx = 0;
  capacities.forEach((cap, gi) => {
    for (let c = 0; c < cap; c++) {
      groups[gi].teamIds.push(shuffled[idx].id);
      idx++;
    }
  });
  const fixtures = {};
  groups.forEach((g) => {
    fixtures[g.id] = roundRobinPairs(g.teamIds);
  });
  return {
    groups,
    fixtures,
    qualifyTarget: numGroups === 2 ? 2 : 4,
    pairingMethod: "seeded",
    knockout: null,
  };
}

export default function TournamentApp() {
  const [page, setPage] = useState("landing"); // landing, organiser-login, organiser-dashboard, organiser-create-p1-3, spectator, spectator-registered
  const [organiserLoggedIn, setOrganiserLoggedIn] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [tournamentSetup, setTournamentSetup] = useState(emptyTournamentSetup());
  const [setupPage, setSetupPage] = useState(1); // 1, 2, 3, 4
  const [teams, setTeams] = useState([]);
  const [teamBaseNames, setTeamBaseNames] = useState([]);
  const [teamInput, setTeamInput] = useState("");
  const [teamInputError, setTeamInputError] = useState("");

  const [currentTournament, setCurrentTournament] = useState(emptyTournament());
  const [pastTournaments, setPastTournaments] = useState([]);

  const [mode, setMode] = useState("spectator");
  const [registered, setRegistered] = useState(false);
  const [userSchool, setUserSchool] = useState("");
  const [spectatorTab, setSpectatorTab] = useState("live");
  const [regForm, setRegForm] = useState({ name: "", email: "", school: "", marketing: false });
  const [regErrors, setRegErrors] = useState({});
  const [followType, setFollowType] = useState("school"); // "school" | "team"
  const [followValue, setFollowValue] = useState("");
  const [schoolTeamInput, setSchoolTeamInput] = useState("");
  const [schoolTeamError, setSchoolTeamError] = useState("");

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "tournaments", "current"),
      (snap) => {
        if (snap.exists()) {
          setCurrentTournament(snap.data());
        }
      },
      (error) => {
        console.error("Firestore sync error:", error);
      }
    );
    return () => unsubscribe();
  }, []);

  async function persist(_key, data) {
    try {
      await setDoc(doc(db, "tournaments", "current"), data);
    } catch (e) {
      console.error("Firestore write failed:", e);
    }
  }

  function handleLogin() {
    setLoginError("");
    if (loginPassword.trim() === ORGANISER_PASSWORD) {
      setOrganiserLoggedIn(true);
      setPage("organiser-dashboard");
      setLoginPassword("");
    } else {
      setLoginError("Incorrect password.");
    }
  }

  function navigate(targetPage) {
    if (targetPage === "spectator") {
      setRegistered(false);
      setRegForm({ name: "", email: "", school: "", marketing: false });
      setFollowValue("");
    }
    setPage(targetPage);
  }

  function startNewTournament() {
    setTournamentSetup(emptyTournamentSetup());
    setSetupPage(1);
    setTeams([]);
    setTeamInput("");
    setPage("organiser-create-p1");
  }

  function nextFromPage1() {
    if (!tournamentSetup.name.trim()) {
      setTeamInputError("Enter tournament name.");
      return;
    }
    if (!tournamentSetup.date) {
      setTeamInputError("Select a date.");
      return;
    }
    if (tournamentSetup.totalTeams < 3) {
      setTeamInputError("At least 3 teams required.");
      return;
    }
    setTeamInputError("");
    setSetupPage(2);
  }

  function addAllMaccabiSchools() {
    const toAdd = MACCABI_SCHOOLS.filter((name) => !teamBaseNames.includes(name));
    setTeamBaseNames([...teamBaseNames, ...toAdd]);
  }

  function addBaseName() {
    setTeamInputError("");
    const cleanName = teamInput.trim();
    if (!cleanName) {
      setTeamInputError("Enter a team name.");
      return;
    }
    if (teamBaseNames.includes(cleanName)) {
      setTeamInputError("This team name is already in the list.");
      return;
    }
    setTeamBaseNames([...teamBaseNames, cleanName]);
    setTeamInput("");
  }

  function removeBaseName(name) {
    setTeamBaseNames(teamBaseNames.filter((n) => n !== name));
    setTeams(teams.filter((t) => t.name !== name));
  }

  function toggleTeamColor(baseName, suffix) {
    const existing = teams.find((t) => t.name === baseName && t.suffix === suffix);
    if (existing) {
      setTeams(teams.filter((t) => t.id !== existing.id));
    } else {
      setTeams([...teams, { id: uid(), name: baseName, suffix }]);
    }
  }

  function nextFromPage2() {
    if (teams.length < tournamentSetup.totalTeams) {
      setTeamInputError(`Add all ${tournamentSetup.totalTeams} teams.`);
      return;
    }
    const teamNames = {};
    const teamSuffixes = {};
    teams.forEach((t) => {
      const fullName = `${t.name} (${t.suffix})`;
      teamNames[t.id] = fullName;
      teamSuffixes[t.id] = t.suffix;
    });

    const greenTeams = teams.filter((t) => t.suffix === "Green");
    const otherTeams = teams.filter((t) => t.suffix !== "Green");
    const splitOffGreen = greenTeams.length >= 4;
    const greenTournament = splitOffGreen ? buildGreenTournament(greenTeams) : null;

    const numGroups = tournamentSetup.numGroups;
    const groups = Array.from({ length: numGroups }, (_, i) => ({
      id: `g${i}`,
      name: `Group ${String.fromCharCode(65 + i)}`,
      teamIds: [],
      extraRoundsGenerated: 0,
    }));
    setCurrentTournament({
      ...emptyTournament(),
      name: tournamentSetup.name,
      date: tournamentSetup.date,
      teamNames,
      teamSuffixes,
      groups,
      structure: tournamentSetup.includeKnockout ? "roundRobinKnockout" : "roundRobin",
      qualifyTarget: tournamentSetup.qualifyTarget,
      pairingMethod: tournamentSetup.pairingMethod,
      greenTournament,
    });
    if (splitOffGreen) {
      setTeams(otherTeams);
    }
    setTeamInputError("");
    setSetupPage(3);
  }

  function updateGroupTeams(groupIdx, newTeamIds) {
    const newGroups = currentTournament.groups.map((grp, i) =>
      i === groupIdx
        ? { ...grp, teamIds: newTeamIds }
        : { ...grp, teamIds: grp.teamIds.filter((id) => !newTeamIds.includes(id)) }
    );
    setCurrentTournament({ ...currentTournament, groups: newGroups });
  }

  function toggleTeamInGroup(groupIdx, teamId) {
    const group = currentTournament.groups[groupIdx];
    const isSelected = group.teamIds.includes(teamId);
    const newTeamIds = isSelected ? group.teamIds.filter((id) => id !== teamId) : [...group.teamIds, teamId];
    updateGroupTeams(groupIdx, newTeamIds);
  }

  function randomizeGroups() {
    const numGroups = currentTournament.groups.length;
    const total = teams.length;
    const base = Math.floor(total / numGroups);
    const remainder = total % numGroups;
    const capacities = Array.from({ length: numGroups }, (_, i) => base + (i < remainder ? 1 : 0));

    const shuffled = [...teams].sort(() => Math.random() - 0.5);

    const buckets = capacities.map((cap) => ({
      cap,
      teamIds: [],
      baseNames: new Set(),
      colorCount: { Red: 0, Blue: 0, Green: 0 },
    }));

    shuffled.forEach((team) => {
      let candidates = buckets
        .map((_, i) => i)
        .filter((i) => buckets[i].teamIds.length < buckets[i].cap && !buckets[i].baseNames.has(team.name));

      if (candidates.length === 0) {
        candidates = buckets.map((_, i) => i).filter((i) => buckets[i].teamIds.length < buckets[i].cap);
      }
      if (candidates.length === 0) return;

      const minColorCount = Math.min(...candidates.map((i) => buckets[i].colorCount[team.suffix]));
      const balanced = candidates.filter((i) => buckets[i].colorCount[team.suffix] === minColorCount);
      const pick = balanced[Math.floor(Math.random() * balanced.length)];

      buckets[pick].teamIds.push(team.id);
      buckets[pick].baseNames.add(team.name);
      buckets[pick].colorCount[team.suffix]++;
    });

    const newGroups = currentTournament.groups.map((g, i) => ({ ...g, teamIds: buckets[i].teamIds }));
    setCurrentTournament({ ...currentTournament, groups: newGroups });
    setTeamInputError("");
  }

  function generateFixtures() {
    setTeamInputError("");
    const badGroup = currentTournament.groups.find((g) => g.teamIds.length < 3 || g.teamIds.length > 6);
    if (badGroup) {
      setTeamInputError(`${badGroup.name} needs 3 to 6 teams (currently ${badGroup.teamIds.length}).`);
      return;
    }
    const fixtures = {};
    currentTournament.groups.forEach((g) => {
      fixtures[g.id] = roundRobinPairs(g.teamIds);
    });
    setCurrentTournament({ ...currentTournament, fixtures });
    setSetupPage(4);
  }

  function launchTournament() {
    persist("tournament-current", { ...currentTournament, isLive: true });
    setCurrentTournament({ ...currentTournament, isLive: true });
    setPage("organiser-scoring");
  }

  function updateScore(groupId, matchId, key, value) {
    const fixtures = { ...currentTournament.fixtures };
    fixtures[groupId] = fixtures[groupId].map((f) =>
      f.id === matchId ? { ...f, [key]: value === "" ? null : Number(value) } : f
    );
    setCurrentTournament({ ...currentTournament, fixtures });
    persist("tournament-current", { ...currentTournament, fixtures });
  }

  function maxGroupSize() {
    return Math.max(...currentTournament.groups.map((g) => g.teamIds.length));
  }

  function equalizerRoundsNeeded(group) {
    if (currentTournament.pairingMethod !== "seeded") return 0;
    return maxGroupSize() - group.teamIds.length;
  }

  function equalizerPairs(standings) {
    const n = standings.length;
    if (n >= 4) {
      return [
        { team1: standings[0].id, team2: standings[3].id },
        { team1: standings[1].id, team2: standings[2].id },
      ];
    }
    // Fewer than 4 teams (only possible with a 3-team group): no 4th-place
    // team exists, so fall back to pairing 1st v 2nd with 3rd sitting out.
    return [{ team1: standings[0].id, team2: standings[1].id }];
  }

  function generateEqualizerRound(groupIdx) {
    const group = currentTournament.groups[groupIdx];
    const standings = computeStandings(group.teamIds, currentTournament.fixtures[group.id], currentTournament.teamNames);
    const newMatches = equalizerPairs(standings).map((p) => ({
      id: uid(),
      team1: p.team1,
      team2: p.team2,
      score1: null,
      score2: null,
      isEqualizer: true,
    }));
    const fixtures = { ...currentTournament.fixtures };
    fixtures[group.id] = [...fixtures[group.id], ...newMatches];
    const groups = currentTournament.groups.map((g, i) =>
      i === groupIdx ? { ...g, extraRoundsGenerated: g.extraRoundsGenerated + 1 } : g
    );
    const updated = { ...currentTournament, fixtures, groups };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
  }

  function allGroupFixturesComplete() {
    return currentTournament.groups.every((g) => {
      const allScored = (currentTournament.fixtures[g.id] || []).every((f) => f.score1 !== null && f.score2 !== null);
      const equalizerDone = g.extraRoundsGenerated >= equalizerRoundsNeeded(g);
      return allScored && equalizerDone;
    });
  }

  function buildKnockoutStage() {
    const qualifiers = buildQualifiers(
      currentTournament.groups,
      currentTournament.fixtures,
      currentTournament.teamNames,
      currentTournament.qualifyTarget
    );
    const { matches } = pairKnockoutRound1(qualifiers, currentTournament.pairingMethod);
    const updated = { ...currentTournament, knockout: { rounds: [matches] } };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
  }

  function updateKnockoutMatch(rIdx, mIdx, key, value) {
    const rounds = currentTournament.knockout.rounds.map((r) => r.map((m) => ({ ...m })));
    const m = rounds[rIdx][mIdx];
    if (key === "shootoutWinner") {
      m.shootoutWinner = value || null;
    } else {
      m[key] = value === "" ? null : Number(value);
    }
    m.winner = matchWinner(m);
    const roundDone = rounds[rIdx].every((mm) => matchWinner(mm));
    if (roundDone && rounds[rIdx].length > 1 && !rounds[rIdx + 1]) {
      const winners = rounds[rIdx].map((mm) => matchWinner(mm));
      const next = [];
      for (let i = 0; i < winners.length; i += 2) {
        next.push(makeKnockoutMatch(winners[i], winners[i + 1] ?? "BYE"));
      }
      rounds.push(next);
    }
    const updated = { ...currentTournament, knockout: { rounds } };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
  }

  // --- Green tournament counterparts (fully independent from the main one) ---

  function updateGreenScore(groupId, matchId, key, value) {
    const gt = currentTournament.greenTournament;
    const fixtures = { ...gt.fixtures };
    fixtures[groupId] = fixtures[groupId].map((f) =>
      f.id === matchId ? { ...f, [key]: value === "" ? null : Number(value) } : f
    );
    const greenTournament = { ...gt, fixtures };
    const updated = { ...currentTournament, greenTournament };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
  }

  function maxGreenGroupSize() {
    return Math.max(...currentTournament.greenTournament.groups.map((g) => g.teamIds.length));
  }

  function equalizerRoundsNeededGreen(group) {
    if (currentTournament.greenTournament.pairingMethod !== "seeded") return 0;
    return maxGreenGroupSize() - group.teamIds.length;
  }

  function generateGreenEqualizerRound(groupIdx) {
    const gt = currentTournament.greenTournament;
    const group = gt.groups[groupIdx];
    const standings = computeStandings(group.teamIds, gt.fixtures[group.id], currentTournament.teamNames);
    const newMatches = equalizerPairs(standings).map((p) => ({
      id: uid(),
      team1: p.team1,
      team2: p.team2,
      score1: null,
      score2: null,
      isEqualizer: true,
    }));
    const fixtures = { ...gt.fixtures };
    fixtures[group.id] = [...fixtures[group.id], ...newMatches];
    const groups = gt.groups.map((g, i) =>
      i === groupIdx ? { ...g, extraRoundsGenerated: g.extraRoundsGenerated + 1 } : g
    );
    const greenTournament = { ...gt, fixtures, groups };
    const updated = { ...currentTournament, greenTournament };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
  }

  function allGreenGroupFixturesComplete() {
    const gt = currentTournament.greenTournament;
    return gt.groups.every((g) => {
      const allScored = (gt.fixtures[g.id] || []).every((f) => f.score1 !== null && f.score2 !== null);
      const equalizerDone = g.extraRoundsGenerated >= equalizerRoundsNeededGreen(g);
      return allScored && equalizerDone;
    });
  }

  function buildGreenKnockoutStage() {
    const gt = currentTournament.greenTournament;
    const qualifiers = buildQualifiers(gt.groups, gt.fixtures, currentTournament.teamNames, gt.qualifyTarget);
    const { matches } = pairKnockoutRound1(qualifiers, gt.pairingMethod);
    const greenTournament = { ...gt, knockout: { rounds: [matches] } };
    const updated = { ...currentTournament, greenTournament };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
  }

  function updateGreenKnockoutMatch(rIdx, mIdx, key, value) {
    const gt = currentTournament.greenTournament;
    const rounds = gt.knockout.rounds.map((r) => r.map((m) => ({ ...m })));
    const m = rounds[rIdx][mIdx];
    if (key === "shootoutWinner") {
      m.shootoutWinner = value || null;
    } else {
      m[key] = value === "" ? null : Number(value);
    }
    m.winner = matchWinner(m);
    const roundDone = rounds[rIdx].every((mm) => matchWinner(mm));
    if (roundDone && rounds[rIdx].length > 1 && !rounds[rIdx + 1]) {
      const winners = rounds[rIdx].map((mm) => matchWinner(mm));
      const next = [];
      for (let i = 0; i < winners.length; i += 2) {
        next.push(makeKnockoutMatch(winners[i], winners[i + 1] ?? "BYE"));
      }
      rounds.push(next);
    }
    const greenTournament = { ...gt, knockout: { rounds } };
    const updated = { ...currentTournament, greenTournament };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
  }

  function simulateGroupStage(groups, existingFixtures, teamNames, pairingMethod, buildsKnockout, qualifyTarget) {
    const fixtures = {};
    let simGroups = groups.map((g) => ({ ...g }));
    const max = Math.max(...simGroups.map((g) => g.teamIds.length));

    simGroups.forEach((g) => {
      fixtures[g.id] = (existingFixtures[g.id] || []).map((f) => ({
        ...f,
        score1: Math.floor(Math.random() * 6),
        score2: Math.floor(Math.random() * 6),
      }));
    });

    if (pairingMethod === "seeded") {
      simGroups = simGroups.map((g) => {
        const needed = max - g.teamIds.length;
        for (let round = 0; round < needed; round++) {
          const standings = computeStandings(g.teamIds, fixtures[g.id], teamNames);
          const newMatches = equalizerPairs(standings).map((p) => ({
            id: uid(),
            team1: p.team1,
            team2: p.team2,
            score1: Math.floor(Math.random() * 6),
            score2: Math.floor(Math.random() * 6),
            isEqualizer: true,
          }));
          fixtures[g.id] = [...fixtures[g.id], ...newMatches];
        }
        return { ...g, extraRoundsGenerated: needed };
      });
    }

    let knockout = null;
    if (buildsKnockout) {
      const qualifiers = buildQualifiers(simGroups, fixtures, teamNames, qualifyTarget);
      const { matches } = pairKnockoutRound1(qualifiers, pairingMethod);
      knockout = { rounds: simulateKnockoutFull(matches) };
    }
    return { fixtures, groups: simGroups, knockout };
  }

  function runTestMode() {
    const main = simulateGroupStage(
      currentTournament.groups,
      currentTournament.fixtures,
      currentTournament.teamNames,
      currentTournament.pairingMethod,
      currentTournament.structure === "roundRobinKnockout",
      currentTournament.qualifyTarget
    );

    let greenTournament = currentTournament.greenTournament;
    if (greenTournament) {
      const green = simulateGroupStage(
        greenTournament.groups,
        greenTournament.fixtures,
        currentTournament.teamNames,
        greenTournament.pairingMethod,
        true,
        greenTournament.qualifyTarget
      );
      greenTournament = { ...greenTournament, fixtures: green.fixtures, groups: green.groups, knockout: green.knockout };
    }

    const updated = {
      ...currentTournament,
      fixtures: main.fixtures,
      groups: main.groups,
      knockout: main.knockout,
      greenTournament,
    };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
  }

  function getFollowedGroups() {
    if (!followValue) return [];
    let relevantTeamIds;
    if (followType === "team") {
      relevantTeamIds = [followValue];
    } else {
      relevantTeamIds = Object.entries(currentTournament.teamNames)
        .filter(([, fullName]) => getBaseName(fullName) === followValue)
        .map(([teamId]) => teamId);
    }
    const mainMatches = currentTournament.groups.filter((g) => g.teamIds.some((id) => relevantTeamIds.includes(id)));
    const greenMatches = currentTournament.greenTournament
      ? currentTournament.greenTournament.groups.filter((g) => g.teamIds.some((id) => relevantTeamIds.includes(id)))
      : [];
    return [...mainMatches, ...greenMatches];
  }

  function submitRegistration() {
    const errs = {};
    if (!regForm.name.trim()) errs.name = "Enter a name.";
    if (!/^\S+@\S+\.\S+$/.test(regForm.email)) errs.email = "Enter a valid email.";
    if (!regForm.school) errs.school = "Select a school.";
    if (!followValue) errs.follow = "Choose a team to follow.";
    setRegErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setRegistered(true);
    setUserSchool(regForm.school);
    const newSchoolTeams = { ...currentTournament.schoolTeams };
    if (!newSchoolTeams[regForm.school]) {
      newSchoolTeams[regForm.school] = [];
    }
    const newRegistrations = [
      ...currentTournament.registrations,
      { ...regForm, date: new Date().toLocaleDateString("en-GB"), source: "QR – pitchside" },
    ];
    const updated = { ...currentTournament, registrations: newRegistrations, schoolTeams: newSchoolTeams };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
  }

  function registerSchoolTeam() {
    setSchoolTeamError("");
    const teamName = schoolTeamInput.trim();
    if (!teamName) {
      setSchoolTeamError("Enter a team name.");
      return;
    }
    const schoolTeams = currentTournament.schoolTeams[userSchool] || [];
    if (schoolTeams.length >= 3) {
      setSchoolTeamError("This school has reached the 3-team limit.");
      return;
    }
    if (schoolTeams.some((st) => st.teamName.toLowerCase() === teamName.toLowerCase())) {
      setSchoolTeamError("This team name is already registered.");
      return;
    }
    const newSchoolTeams = { ...currentTournament.schoolTeams };
    if (!newSchoolTeams[userSchool]) {
      newSchoolTeams[userSchool] = [];
    }
    const teamId = `${userSchool}-team-${uid()}`;
    newSchoolTeams[userSchool].push({ teamName, id: teamId });
    const updated = { ...currentTournament, schoolTeams: newSchoolTeams };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
    setSchoolTeamInput("");
  }

  function removeSchoolTeam(teamId) {
    const newSchoolTeams = { ...currentTournament.schoolTeams };
    if (newSchoolTeams[userSchool]) {
      newSchoolTeams[userSchool] = newSchoolTeams[userSchool].filter((st) => st.id !== teamId);
    }
    const updated = { ...currentTournament, schoolTeams: newSchoolTeams };
    setCurrentTournament(updated);
    persist("tournament-current", updated);
  }

  function downloadExcel() {
    const rows = currentTournament.registrations.map((r) => ({
      Name: r.name,
      Email: r.email,
      "Constituent code": "Tournament Supporter",
      School: r.school,
      Event: currentTournament.name,
      Date: r.date,
      "Marketing consent": r.marketing ? "Yes" : "No",
      Source: r.source || "",
    }));
    if (!rows.length) {
      alert("No registrations to export yet.");
      return;
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Registrations");
    XLSX.writeFile(wb, "tournament-registrations.xlsx");
  }

  // Landing page
  if (page === "landing") {
    return (
      <div style={styles.app}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Maccabi GB • Tournament Hub</div>
            <h1 style={styles.h1}>Tournament Dashboard</h1>
          </div>
        </header>
        <div style={styles.gate}>
          <div style={styles.gateCard}>
            <div style={styles.logo}>MGB</div>
            <h2 style={styles.gateH2}>Get started</h2>
            <p style={styles.gateP}>Choose your role to continue.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <button
                style={styles.primary}
                onClick={() => setPage("organiser-login")}
              >
                Organiser
              </button>
              <button
                style={{ ...styles.primary, background: "#687385" }}
                onClick={() => navigate("spectator")}
              >
                Spectator
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Organiser login
  if (page === "organiser-login") {
    return (
      <div style={styles.app}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Maccabi GB • Tournament Hub</div>
            <h1 style={styles.h1}>Organiser Login</h1>
          </div>
        </header>
        <div style={styles.gate}>
          <div style={styles.gateCard}>
            <div style={styles.logo}>MGB</div>
            <h2 style={styles.gateH2}>Organiser access</h2>
            <p style={styles.gateP}>Enter password to continue.</p>
            <div style={styles.form}>
              <div>
                <label style={styles.label}>Password</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  style={styles.input}
                  autoFocus
                />
                {loginError && <p style={styles.error}>{loginError}</p>}
              </div>
              <button type="button" onClick={handleLogin} style={styles.primaryWide}>
                Login
              </button>
            </div>
            <button
              onClick={() => setPage("landing")}
              style={{ ...styles.secondary, width: "100%", marginTop: "12px" }}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Organiser dashboard
  if (page === "organiser-dashboard" && organiserLoggedIn) {
    return (
      <div style={styles.app}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Maccabi GB • Tournament Hub</div>
            <h1 style={styles.h1}>Organiser Dashboard</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <ModeSwitcher current="organiser" onSwitch={navigate} isLive={currentTournament.isLive} />
            <button
              onClick={() => {
                setOrganiserLoggedIn(false);
                setPage("landing");
              }}
              style={styles.secondary}
            >
              Logout
            </button>
          </div>
        </header>
        <div style={styles.adminBar}>
          <div>
            <div style={styles.pill}>ORGANISER</div>
            <h2 style={styles.adminH2}>Tournament Hub</h2>
            <p style={styles.adminP}>Manage your tournaments.</p>
          </div>
        </div>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 5vw" }}>
          <button style={styles.primary} onClick={startNewTournament}>
            Create new tournament
          </button>
          {pastTournaments.length > 0 && (
            <section style={{ ...styles.card, marginTop: "20px" }}>
              <h3 style={styles.h3}>Previous tournaments</h3>
              {pastTournaments.map((t) => (
                <div key={t.id} style={styles.regItem}>
                  <div>
                    <b>{t.name}</b>
                    <p style={styles.adminP}>{t.date} • {t.createdAt}</p>
                  </div>
                  <button
                    style={styles.secondary}
                    onClick={() => {
                      setCurrentTournament(t);
                      setPage("organiser-scoring");
                    }}
                  >
                    View
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    );
  }

  // Organiser create - Page 1
  if (page === "organiser-create-p1" && organiserLoggedIn && setupPage === 1) {
    return (
      <div style={styles.app}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Maccabi GB • Tournament Hub</div>
            <h1 style={styles.h1}>Create Tournament</h1>
          </div>
        </header>
        <div style={styles.adminBar}>
          <div>
            <div style={styles.pill}>STEP 1/4</div>
            <h2 style={styles.adminH2}>Tournament details</h2>
            <p style={styles.adminP}>Set up the basics.</p>
          </div>
        </div>
        <div style={{ maxWidth: "600px", margin: "0 auto", padding: "28px 5vw" }}>
          <section style={styles.card}>
            <label style={styles.label}>Tournament name</label>
            <input
              value={tournamentSetup.name}
              onChange={(e) => setTournamentSetup({ ...tournamentSetup, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && nextFromPage1()}
              style={{ ...styles.input, marginBottom: "20px" }}
              placeholder="Dads Football Tournament"
              autoFocus
            />
            <label style={styles.label}>Tournament date</label>
            <input
              type="date"
              value={tournamentSetup.date}
              onChange={(e) => setTournamentSetup({ ...tournamentSetup, date: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && nextFromPage1()}
              style={{ ...styles.input, marginBottom: "20px" }}
            />
            <label style={styles.label}>Total number of teams</label>
            <select
              value={tournamentSetup.totalTeams}
              onChange={(e) => {
                const total = Number(e.target.value);
                const maxGroups = Math.floor(total / 3);
                setTournamentSetup({
                  ...tournamentSetup,
                  totalTeams: total,
                  numGroups: Math.min(tournamentSetup.numGroups, maxGroups),
                });
              }}
              style={{ ...styles.input, marginBottom: "20px" }}
            >
              {Array.from({ length: 48 }, (_, i) => i + 3).map((n) => (
                <option key={n} value={n}>
                  {n} teams
                </option>
              ))}
            </select>
            <label style={styles.label}>Number of groups</label>
            <select
              value={tournamentSetup.numGroups}
              onChange={(e) => setTournamentSetup({ ...tournamentSetup, numGroups: Number(e.target.value) })}
              style={{ ...styles.input, marginBottom: "20px" }}
            >
              {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => {
                const maxTeamsInAnyGroup = Math.ceil(tournamentSetup.totalTeams / n);
                const minTeamsInAnyGroup = Math.floor(tournamentSetup.totalTeams / n);
                const valid = maxTeamsInAnyGroup <= 6 && minTeamsInAnyGroup >= 3;
                const sizeLabel =
                  maxTeamsInAnyGroup === minTeamsInAnyGroup
                    ? `${maxTeamsInAnyGroup} per group`
                    : `${minTeamsInAnyGroup}\u2013${maxTeamsInAnyGroup} per group`;
                return (
                  <option key={n} value={n} disabled={!valid}>
                    {n} group{n !== 1 ? "s" : ""} ({sizeLabel})
                  </option>
                );
              })}
            </select>
            <label style={{ ...styles.checkLabel, marginBottom: "16px" }}>
              <input
                type="checkbox"
                checked={tournamentSetup.includeKnockout}
                onChange={(e) => setTournamentSetup({ ...tournamentSetup, includeKnockout: e.target.checked })}
              />
              <span>Include a knockout stage after the groups</span>
            </label>
            {tournamentSetup.includeKnockout && (
              <div style={styles.row}>
                <div>
                  <label style={styles.label}>Teams qualifying</label>
                  <select
                    value={tournamentSetup.qualifyTarget}
                    onChange={(e) => setTournamentSetup({ ...tournamentSetup, qualifyTarget: Number(e.target.value) })}
                    style={styles.input}
                  >
                    <option value={4}>Top 4</option>
                    <option value={8}>Top 8</option>
                  </select>
                </div>
                <div>
                  <label style={styles.label}>Round 1 pairing</label>
                  <select
                    value={tournamentSetup.pairingMethod}
                    onChange={(e) => setTournamentSetup({ ...tournamentSetup, pairingMethod: e.target.value })}
                    style={styles.input}
                  >
                    <option value="seeded">Seeded (1v8, 2v7…)</option>
                    <option value="cross">Cross pairing</option>
                  </select>
                </div>
              </div>
            )}
            {teamInputError && <p style={styles.error}>{teamInputError}</p>}
            <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
              <button style={styles.secondary} onClick={() => setPage("organiser-dashboard")}>
                Cancel
              </button>
              <button style={styles.primary} onClick={nextFromPage1}>
                Next
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // Organiser create - Page 2
  if (page === "organiser-create-p1" && organiserLoggedIn && setupPage === 2) {
    return (
      <div style={styles.app}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Maccabi GB • Tournament Hub</div>
            <h1 style={styles.h1}>Create Tournament</h1>
          </div>
        </header>
        <div style={styles.adminBar}>
          <div>
            <div style={styles.pill}>STEP 2/4</div>
            <h2 style={styles.adminH2}>Add teams</h2>
            <p style={styles.adminP}>Add each team name, then tick which colours are entering.</p>
          </div>
        </div>
        <div style={{ maxWidth: "600px", margin: "0 auto", padding: "28px 5vw" }}>
          <section style={styles.card}>
            <p style={{ color: "#687385", fontSize: "13px", marginBottom: "12px" }}>
              Add a team name once, then tick Red, Blue and/or Green to register that many entries under the same name. Press Enter to add a name.
            </p>
            <button
              type="button"
              onClick={addAllMaccabiSchools}
              style={{ ...styles.secondary, marginBottom: "12px", width: "100%" }}
            >
              + Add all Maccabi GB schools
            </button>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
              <input
                type="text"
                value={teamInput}
                onChange={(e) => setTeamInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addBaseName()}
                placeholder="e.g. Maccabi"
                style={{ ...styles.input, flex: 1, margin: 0 }}
              />
              <button onClick={addBaseName} style={{ ...styles.primary, margin: 0 }}>
                Add
              </button>
            </div>
            {teamInputError && <p style={styles.error}>{teamInputError}</p>}
            <div style={styles.teamList}>
              {teamBaseNames.map((name) => (
                <div key={name} style={{ ...styles.teamItem, flexDirection: "column", alignItems: "stretch", gap: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600 }}>{name}</span>
                    <button onClick={() => removeBaseName(name)} style={styles.removeButton}>
                      ✕
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: "14px" }}>
                    {["Red", "Blue", "Green"].map((color) => {
                      const checked = teams.some((t) => t.name === name && t.suffix === color);
                      return (
                        <label key={color} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTeamColor(name, color)}
                          />
                          {color}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: "12px", color: "#687385", marginTop: "12px" }}>
              {teams.length} / {tournamentSetup.totalTeams}
            </p>
            <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
              <button style={styles.secondary} onClick={() => setSetupPage(1)}>
                Back
              </button>
              <button style={styles.primary} onClick={nextFromPage2}>
                Next
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // Organiser create - Page 3
  if (page === "organiser-create-p1" && organiserLoggedIn && setupPage === 3) {
    return (
      <div style={styles.app}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Maccabi GB • Tournament Hub</div>
            <h1 style={styles.h1}>Create Tournament</h1>
          </div>
        </header>
        <div style={styles.adminBar}>
          <div>
            <div style={styles.pill}>STEP 3/4</div>
            <h2 style={styles.adminH2}>Assign to groups</h2>
            <p style={styles.adminP}>Select 3–6 teams per group, or randomly generate — no same-name pair in one group, colors balanced where possible.</p>
          </div>
          <button style={styles.primary} onClick={randomizeGroups}>
            Randomly generate groups
          </button>
        </div>
        {currentTournament.greenTournament && (
          <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 5vw" }}>
            <div style={{ ...styles.card, background: "#eafaf0", border: "1px solid #b8e6c9", marginTop: "16px" }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#18794e" }}>
                {Object.keys(currentTournament.teamNames).filter((id) => currentTournament.teamSuffixes[id] === "Green").length} Green
                teams found — they've been split into their own separate Green tournament ({currentTournament.greenTournament.groups.length} groups,
                fixtures already generated). They won't appear in the group assignment below. You'll find the Green tournament as its own
                section on the scoring page.
              </p>
            </div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "18px", maxWidth: "1200px", margin: "0 auto", padding: "28px 5vw" }}>
          {currentTournament.groups.map((g, gIdx) => (
            <section key={g.id} style={styles.card}>
              <h3 style={styles.h3}>{g.name}</h3>
              <p style={{ fontSize: "13px", color: "#687385", margin: "0 0 12px" }}>
                {g.teamIds.length} team{g.teamIds.length !== 1 ? "s" : ""}
              </p>
              <div style={styles.teamCheckList}>
                {teams.map((team) => {
                  const usedByOther = currentTournament.groups.some((grp, i) => i !== gIdx && grp.teamIds.includes(team.id));
                  const isSelected = g.teamIds.includes(team.id);
                  return (
                    <label
                      key={team.id}
                      style={{
                        ...styles.teamCheckItem,
                        ...(usedByOther ? styles.teamCheckItemDisabled : {}),
                        ...(isSelected ? styles.teamCheckItemSelected : {}),
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={usedByOther}
                        onChange={() => toggleTeamInGroup(gIdx, team.id)}
                        style={{ marginRight: "8px" }}
                      />
                      {team.name} ({team.suffix})
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {teamInputError && <p style={{ ...styles.error, textAlign: "center", marginTop: "20px" }}>{teamInputError}</p>}
        <div style={{ textAlign: "center", padding: "0 5vw 40px", display: "flex", gap: "12px", justifyContent: "center", maxWidth: "600px", margin: "20px auto 0" }}>
          <button style={styles.secondary} onClick={() => setSetupPage(2)}>
            Back
          </button>
          <button style={styles.primary} onClick={generateFixtures}>
            Generate fixtures
          </button>
        </div>
      </div>
    );
  }

  // Organiser create - Page 4
  if (page === "organiser-create-p1" && organiserLoggedIn && setupPage === 4) {
    return (
      <div style={styles.app}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Maccabi GB • Tournament Hub</div>
            <h1 style={styles.h1}>Create Tournament</h1>
          </div>
        </header>
        <div style={styles.adminBar}>
          <div>
            <div style={styles.pill}>STEP 4/4</div>
            <h2 style={styles.adminH2}>Review fixtures</h2>
            <p style={styles.adminP}>Check fixtures before launching.</p>
          </div>
        </div>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 5vw 40px" }}>
          {currentTournament.groups.map((g) => (
            <section key={g.id} style={{ ...styles.card, marginBottom: "18px" }}>
              <h3 style={styles.h3}>{g.name}</h3>
              {currentTournament.fixtures[g.id] &&
                currentTournament.fixtures[g.id].map((f) => (
                  <div key={f.id} style={styles.fixture}>
                    <span>{currentTournament.teamNames[f.team1]}</span>
                    <b style={{ textAlign: "center" }}>vs</b>
                    <span style={{ textAlign: "right" }}>{currentTournament.teamNames[f.team2]}</span>
                  </div>
                ))}
            </section>
          ))}
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", padding: "0 5vw" }}>
            <button style={styles.secondary} onClick={() => setSetupPage(3)}>
              Back
            </button>
            <button style={styles.primary} onClick={launchTournament}>
              Launch tournament
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Organiser scoring
  if (page === "organiser-scoring" && organiserLoggedIn) {
    return (
      <div style={styles.app}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Maccabi GB • Tournament Hub</div>
            <h1 style={styles.h1}>{currentTournament.name}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <ModeSwitcher current="organiser" onSwitch={navigate} isLive={currentTournament.isLive} />
            <button
              onClick={() => {
                setOrganiserLoggedIn(false);
                setPage("landing");
              }}
              style={styles.secondary}
            >
              Logout
            </button>
          </div>
        </header>
        <div style={styles.adminBar}>
          <div>
            <div style={styles.pill}>LIVE</div>
            <h2 style={styles.adminH2}>Control centre</h2>
            <p style={styles.adminP}>Enter scores and manage registrations.</p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button style={styles.secondary} onClick={runTestMode}>
              Test mode: randomise all results
            </button>
            <button style={styles.primary} onClick={downloadExcel}>
              Download Excel
            </button>
          </div>
        </div>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 5vw 40px" }}>
          {currentTournament.groups.map((g) => {
            const needed = equalizerRoundsNeeded(g);
            const currentFixtures = currentTournament.fixtures[g.id] || [];
            const allCurrentScored = currentFixtures.every((f) => f.score1 !== null && f.score2 !== null);
            const canGenerateEqualizer = needed > g.extraRoundsGenerated && allCurrentScored;
            return (
              <section key={g.id} style={{ ...styles.card, marginBottom: "18px" }}>
                <div style={styles.sectionHead}>
                  <h3 style={styles.h3}>{g.name}</h3>
                  <span style={styles.sectionSpan}>{g.teamIds.length} teams</span>
                </div>
                <h4 style={{ ...styles.h3, marginTop: "18px" }}>Scores</h4>
                {currentFixtures.map((f) => (
                  <div key={f.id} style={styles.match}>
                    <span>
                      {currentTournament.teamNames[f.team1]}
                      {f.isEqualizer && <span style={{ fontSize: "10px", color: "#687385", marginLeft: "4px" }}>(equalizer)</span>}
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={f.score1 ?? ""}
                      onChange={(e) => updateScore(g.id, f.id, "score1", e.target.value)}
                      style={styles.scoreInput}
                    />
                    <span style={styles.matchVs}>v</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={f.score2 ?? ""}
                      onChange={(e) => updateScore(g.id, f.id, "score2", e.target.value)}
                      style={styles.scoreInput}
                    />
                    <span>{currentTournament.teamNames[f.team2]}</span>
                  </div>
                ))}
                <StandingsTable group={g} fixtures={currentFixtures} teamNames={currentTournament.teamNames} />
                {needed > 0 && (
                  <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid #edf0f3" }}>
                    <p style={{ fontSize: "12px", color: "#687385", margin: "0 0 8px" }}>
                      This group has fewer teams than the largest group — {g.extraRoundsGenerated}/{needed} equalizer round{needed !== 1 ? "s" : ""} added so every team plays the same number of games before seeding.
                    </p>
                    {needed > g.extraRoundsGenerated && (
                      <button
                        style={styles.secondary}
                        disabled={!canGenerateEqualizer}
                        onClick={() => generateEqualizerRound(currentTournament.groups.findIndex((grp) => grp.id === g.id))}
                      >
                        {allCurrentScored ? "Generate equalizer game" : "Enter all scores first"}
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}

          {currentTournament.structure === "roundRobinKnockout" && (
            <section style={{ ...styles.card, marginBottom: "18px" }}>
              <div style={styles.sectionHead}>
                <h3 style={styles.h3}>Knockout stage</h3>
                {!currentTournament.knockout && (
                  <button
                    style={styles.primary}
                    onClick={buildKnockoutStage}
                    disabled={!allGroupFixturesComplete()}
                  >
                    Build knockout stage
                  </button>
                )}
              </div>
              {!currentTournament.knockout && !allGroupFixturesComplete() && (
                <p style={{ ...styles.adminP, margin: 0 }}>Enter all group scores (and any equalizer games) to build the knockout bracket.</p>
              )}
              {currentTournament.knockout && (
                <KnockoutBracket rounds={currentTournament.knockout.rounds} editable onUpdate={updateKnockoutMatch} />
              )}
            </section>
          )}

          {currentTournament.greenTournament && (
            <section style={{ ...styles.card, marginBottom: "18px", border: "1px solid #b8e6c9" }}>
              <div style={styles.sectionHead}>
                <h3 style={styles.h3}>Green tournament</h3>
                <span style={styles.sectionSpan}>Fully separate — {currentTournament.greenTournament.groups.length} groups</span>
              </div>
              <p style={{ ...styles.adminP, margin: "0 0 16px" }}>
                4+ Green teams triggered a standalone tournament. Top {currentTournament.greenTournament.qualifyTarget} qualify
                {currentTournament.greenTournament.groups.length === 2 ? " — with 2 groups, this is the group winners going straight to a final." : "."}
              </p>
              {currentTournament.greenTournament.groups.map((g, gIdx) => {
                const gt = currentTournament.greenTournament;
                const needed = equalizerRoundsNeededGreen(g);
                const currentFixtures = gt.fixtures[g.id] || [];
                const allCurrentScored = currentFixtures.every((f) => f.score1 !== null && f.score2 !== null);
                const canGenerateEqualizer = needed > g.extraRoundsGenerated && allCurrentScored;
                return (
                  <div key={g.id} style={{ marginBottom: "20px", paddingBottom: "16px", borderBottom: "1px solid #edf0f3" }}>
                    <div style={styles.sectionHead}>
                      <h4 style={{ ...styles.h3, margin: 0 }}>{g.name}</h4>
                      <span style={styles.sectionSpan}>{g.teamIds.length} teams</span>
                    </div>
                    {currentFixtures.map((f) => (
                      <div key={f.id} style={styles.match}>
                        <span>
                          {currentTournament.teamNames[f.team1]}
                          {f.isEqualizer && <span style={{ fontSize: "10px", color: "#687385", marginLeft: "4px" }}>(equalizer)</span>}
                        </span>
                        <input
                          type="number"
                          min="0"
                          max="20"
                          value={f.score1 ?? ""}
                          onChange={(e) => updateGreenScore(g.id, f.id, "score1", e.target.value)}
                          style={styles.scoreInput}
                        />
                        <span style={styles.matchVs}>v</span>
                        <input
                          type="number"
                          min="0"
                          max="20"
                          value={f.score2 ?? ""}
                          onChange={(e) => updateGreenScore(g.id, f.id, "score2", e.target.value)}
                          style={styles.scoreInput}
                        />
                        <span>{currentTournament.teamNames[f.team2]}</span>
                      </div>
                    ))}
                    <StandingsTable group={g} fixtures={currentFixtures} teamNames={currentTournament.teamNames} />
                    {needed > 0 && (
                      <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #edf0f3" }}>
                        <p style={{ fontSize: "12px", color: "#687385", margin: "0 0 8px" }}>
                          {g.extraRoundsGenerated}/{needed} equalizer round{needed !== 1 ? "s" : ""} added.
                        </p>
                        {needed > g.extraRoundsGenerated && (
                          <button
                            style={styles.secondary}
                            disabled={!canGenerateEqualizer}
                            onClick={() => generateGreenEqualizerRound(gIdx)}
                          >
                            {allCurrentScored ? "Generate equalizer game" : "Enter all scores first"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={styles.sectionHead}>
                <h4 style={{ ...styles.h3, margin: 0 }}>Green knockout</h4>
                {!currentTournament.greenTournament.knockout && (
                  <button
                    style={styles.primary}
                    onClick={buildGreenKnockoutStage}
                    disabled={!allGreenGroupFixturesComplete()}
                  >
                    Build knockout stage
                  </button>
                )}
              </div>
              {!currentTournament.greenTournament.knockout && !allGreenGroupFixturesComplete() && (
                <p style={{ ...styles.adminP, margin: 0 }}>Enter all Green group scores (and any equalizer games) to build the bracket.</p>
              )}
              {currentTournament.greenTournament.knockout && (
                <KnockoutBracket rounds={currentTournament.greenTournament.knockout.rounds} editable onUpdate={updateGreenKnockoutMatch} />
              )}
            </section>
          )}

          <section style={styles.card}>
            <div style={styles.sectionHead}>
              <div>
                <h3 style={styles.h3}>Supporter registrations</h3>
                <p style={styles.adminP}>{currentTournament.registrations.length} captured</p>
              </div>
              <button style={styles.secondary} onClick={downloadExcel}>
                Export for Raiser's Edge
              </button>
            </div>
            {currentTournament.registrations.length ? (
              <div style={styles.regsList}>
                {currentTournament.registrations.map((r, i) => (
                  <div key={i} style={styles.regItem}>
                    <b>{r.name}</b>
                    <span style={styles.regSpan}>
                      {r.email} • {r.school} • Marketing: {r.marketing ? "Yes" : "No"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={styles.empty}>Registrations will appear here when spectators pass the login gate.</div>
            )}
          </section>
        </div>
      </div>
    );
  }

  // Spectator view
  if (page === "spectator") {
    return (
      <div style={styles.app}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Maccabi GB • Tournament Hub</div>
            <h1 style={styles.h1}>{currentTournament.name || "Tournament"}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {organiserLoggedIn ? (
              <ModeSwitcher current="spectator" onSwitch={navigate} isLive={currentTournament.isLive} />
            ) : (
              <div style={styles.switch}>
                <button
                  style={{ ...styles.switchButton, background: "#19334d", color: "#fff" }}
                  onClick={() => setPage("landing")}
                >
                  Back
                </button>
              </div>
            )}
          </div>
        </header>

        {!registered ? (
          <div style={styles.gate}>
            <div style={styles.gateCard}>
              <div style={styles.logo}>MGB</div>
              <div style={styles.pill}>SPECTATOR ACCESS</div>
              <h2 style={styles.gateH2}>Welcome to the tournament</h2>
              <p style={styles.gateP}>Register once to see live scores, fixtures and tables.</p>
              <div style={styles.form}>
                <div>
                  <label style={styles.label}>Name</label>
                  <input
                    value={regForm.name}
                    onChange={(e) => setRegForm({ ...regForm, name: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && submitRegistration()}
                    style={styles.input}
                  />
                  {regErrors.name && <p style={styles.error}>{regErrors.name}</p>}
                </div>
                <div>
                  <label style={styles.label}>Email</label>
                  <input
                    type="email"
                    value={regForm.email}
                    onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && submitRegistration()}
                    style={styles.input}
                  />
                  {regErrors.email && <p style={styles.error}>{regErrors.email}</p>}
                </div>
                <div>
                  <label style={styles.label}>School</label>
                  <select
                    value={regForm.school}
                    onChange={(e) => setRegForm({ ...regForm, school: e.target.value })}
                    style={styles.input}
                  >
                    <option value="">Select school</option>
                    {Array.from(new Set(Object.values(currentTournament.teamNames).map((n) => getBaseName(n)))).map((school) => (
                      <option key={school} value={school}>
                        {school}
                      </option>
                    ))}
                  </select>
                  {regErrors.school && <p style={styles.error}>{regErrors.school}</p>}
                </div>
                <div>
                  <label style={styles.label}>Who are you following?</label>
                  <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setFollowType("school");
                        setFollowValue("");
                      }}
                      style={{
                        ...styles.choiceButton,
                        flex: 1,
                        ...(followType === "school" ? styles.chosenButton : {}),
                      }}
                    >
                      A school (all its teams)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFollowType("team");
                        setFollowValue("");
                      }}
                      style={{
                        ...styles.choiceButton,
                        flex: 1,
                        ...(followType === "team" ? styles.chosenButton : {}),
                      }}
                    >
                      A specific team
                    </button>
                  </div>
                  {followType === "school" ? (
                    <select value={followValue} onChange={(e) => setFollowValue(e.target.value)} style={styles.input}>
                      <option value="">Select a school</option>
                      {Array.from(new Set(Object.values(currentTournament.teamNames).map((n) => getBaseName(n)))).map(
                        (baseName) => (
                          <option key={baseName} value={baseName}>
                            {baseName} (all teams)
                          </option>
                        )
                      )}
                    </select>
                  ) : (
                    <select value={followValue} onChange={(e) => setFollowValue(e.target.value)} style={styles.input}>
                      <option value="">Select a team</option>
                      {Object.entries(currentTournament.teamNames).map(([teamId, fullName]) => (
                        <option key={teamId} value={teamId}>
                          {fullName}
                        </option>
                      ))}
                    </select>
                  )}
                  {regErrors.follow && <p style={styles.error}>{regErrors.follow}</p>}
                </div>
                <label style={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={regForm.marketing}
                    onChange={(e) => setRegForm({ ...regForm, marketing: e.target.checked })}
                  />
                  <span>I'd like to receive relevant Maccabi GB updates and opportunities.</span>
                </label>
                <button type="button" onClick={submitRegistration} style={styles.primaryWide}>
                  View live tournament
                </button>
              </div>
              <small style={styles.small}>Marketing consent is optional.</small>
            </div>
          </div>
        ) : (
          <>
            <section style={styles.hero}>
              <span style={styles.live}>● LIVE</span>
              <h2 style={styles.heroH2}>Follow the tournament live</h2>
              <p style={styles.heroP}>Scores and tables update as organisers enter results.</p>
            </section>
            <nav style={styles.tabs}>
              <button
                style={{
                  ...styles.tabButton,
                  ...(spectatorTab === "live" ? styles.tabActive : {}),
                }}
                onClick={() => setSpectatorTab("live")}
              >
                Live tables
              </button>
              <button
                style={{
                  ...styles.tabButton,
                  ...(spectatorTab === "fixtures" ? styles.tabActive : {}),
                }}
                onClick={() => setSpectatorTab("fixtures")}
              >
                Fixtures
              </button>
              <button
                style={{
                  ...styles.tabButton,
                  ...(spectatorTab === "school" ? styles.tabActive : {}),
                }}
                onClick={() => setSpectatorTab("school")}
              >
                {userSchool} teams
              </button>
              <button
                style={{
                  ...styles.tabButton,
                  ...(spectatorTab === "followed" ? styles.tabActive : {}),
                }}
                onClick={() => setSpectatorTab("followed")}
              >
                {followValue ? (followType === "team" ? currentTournament.teamNames[followValue] : followValue) : "Your team"}
              </button>
            </nav>
            <div style={spectatorTab === "school" || spectatorTab === "followed" ? styles.gridSingle : styles.grid}>
              {spectatorTab === "live"
                ? currentTournament.groups.map((g) => <StandingsCard key={g.id} group={g} fixtures={currentTournament.fixtures[g.id]} teamNames={currentTournament.teamNames} />)
                : spectatorTab === "fixtures"
                ? currentTournament.groups.map((g) => <FixturesCard key={g.id} group={g} fixtures={currentTournament.fixtures[g.id]} teamNames={currentTournament.teamNames} />)
                : spectatorTab === "school"
                ? <SchoolTeamsCard school={userSchool} schoolTeams={currentTournament.schoolTeams[userSchool] || []} onAdd={registerSchoolTeam} onRemove={removeSchoolTeam} teamInput={schoolTeamInput} setTeamInput={setSchoolTeamInput} error={schoolTeamError} />
                : getFollowedGroups().map((g) => {
                    const isGreenGroup = currentTournament.greenTournament?.groups.some((gg) => gg.id === g.id);
                    const groupFixtures = isGreenGroup ? currentTournament.greenTournament.fixtures[g.id] : currentTournament.fixtures[g.id];
                    return (
                      <div key={g.id} style={{ display: "grid", gap: "18px" }}>
                        <StandingsCard group={g} fixtures={groupFixtures} teamNames={currentTournament.teamNames} />
                        <FixturesCard group={g} fixtures={groupFixtures} teamNames={currentTournament.teamNames} />
                      </div>
                    );
                  })}
            </div>
          </>
        )}
      </div>
    );
  }

  return null;
}

function ModeSwitcher({ current, onSwitch, isLive }) {
  return (
    <div style={{ display: "flex", background: "#19334d", borderRadius: "12px", padding: "4px", gap: "4px" }}>
      <button
        onClick={() => onSwitch(isLive ? "organiser-scoring" : "organiser-dashboard")}
        style={{
          border: 0,
          background: current === "organiser" ? "#fff" : "transparent",
          color: current === "organiser" ? "#0b1f33" : "#fff",
          padding: "9px 14px",
          borderRadius: "9px",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        Organiser
      </button>
      <button
        onClick={() => onSwitch("spectator")}
        style={{
          border: 0,
          background: current === "spectator" ? "#fff" : "transparent",
          color: current === "spectator" ? "#0b1f33" : "#fff",
          padding: "9px 14px",
          borderRadius: "9px",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        Spectator
      </button>
    </div>
  );
}

function KnockoutBracket({ rounds, editable, onUpdate }) {
  return (
    <div style={{ display: "flex", gap: "16px", overflowX: "auto", paddingBottom: "8px" }}>
      {rounds.map((round, rIdx) => (
        <div key={rIdx} style={{ flexShrink: 0, width: "220px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <p style={{ fontSize: "13px", fontWeight: 600, color: "#687385", margin: 0 }}>
            {roundLabel(rIdx, rounds.length)}
          </p>
          {round.map((m, mIdx) => {
            const w = matchWinner(m);
            const tied = m.score1 !== null && m.score2 !== null && m.score1 === m.score2;
            return (
              <div key={m.id} style={{ background: "#fff", border: "1px solid #e1e6eb", borderRadius: "10px", padding: "10px 12px" }}>
                {[
                  { name: m.team1, score: m.score1, key: "1" },
                  { name: m.team2, score: m.score2, key: "2" },
                ].map((row) => (
                  <div
                    key={row.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "3px 0",
                      fontWeight: w === row.name ? 700 : 400,
                    }}
                  >
                    <span style={{ fontSize: "13px", color: row.name ? "#18212f" : "#8993a0" }}>{row.name ?? "TBD"}</span>
                    {editable && row.name && row.name !== "BYE" ? (
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={row.score ?? ""}
                        onChange={(e) => onUpdate(rIdx, mIdx, `score${row.key}`, e.target.value)}
                        style={{ width: "44px", padding: "6px", border: "1px solid #ccd3db", borderRadius: "6px", textAlign: "center", fontSize: "12px" }}
                      />
                    ) : (
                      row.name && <span style={{ fontSize: "13px", color: "#687385" }}>{row.score ?? "\u2013"}</span>
                    )}
                  </div>
                ))}
                {tied && (
                  <div style={{ marginTop: "6px", paddingTop: "6px", borderTop: "1px solid #edf0f3" }}>
                    <p style={{ fontSize: "11px", color: "#8993a0", margin: "0 0 4px" }}>Scores level — tick the shootout winner</p>
                    {[m.team1, m.team2].map((teamName) => (
                      <label key={teamName} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", padding: "2px 0" }}>
                        {editable ? (
                          <input
                            type="checkbox"
                            checked={m.shootoutWinner === teamName}
                            onChange={() => onUpdate(rIdx, mIdx, "shootoutWinner", m.shootoutWinner === teamName ? "" : teamName)}
                          />
                        ) : (
                          <span style={{ width: "13px", textAlign: "center" }}>{m.shootoutWinner === teamName ? "✓" : ""}</span>
                        )}
                        {teamName} won shootout
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function StandingsCard({ group, fixtures, teamNames }) {
  const standings = computeStandings(group.teamIds, fixtures, teamNames);
  return (
    <section style={styles.card}>
      <div style={styles.sectionHead}>
        <h3 style={styles.h3}>{group.name}</h3>
        <span style={styles.sectionSpan}>3 win • 1 draw</span>
      </div>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>#</th>
            <th style={styles.th}>Team</th>
            <th style={styles.th}>P</th>
            <th style={styles.th}>GD</th>
            <th style={styles.th}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((r, j) => (
            <tr key={r.id}>
              <td style={styles.td}>{j + 1}</td>
              <td style={{ ...styles.td, textAlign: "left" }}>
                <b>{r.name}</b>
              </td>
              <td style={styles.td}>{r.played}</td>
              <td style={styles.td}>{r.gd > 0 ? "+" : ""}{r.gd}</td>
              <td style={{ ...styles.td, fontWeight: 600 }}>{r.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StandingsTable({ group, fixtures, teamNames }) {
  const standings = computeStandings(group.teamIds, fixtures, teamNames);
  return (
    <table style={{ ...styles.table, marginTop: "14px" }}>
      <thead>
        <tr>
          <th style={styles.th}>#</th>
          <th style={styles.th}>Team</th>
          <th style={styles.th}>P</th>
          <th style={styles.th}>GD</th>
          <th style={styles.th}>Pts</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((r, j) => (
          <tr key={r.id}>
            <td style={styles.td}>{j + 1}</td>
            <td style={{ ...styles.td, textAlign: "left" }}>
              <b>{r.name}</b>
            </td>
            <td style={styles.td}>{r.played}</td>
            <td style={styles.td}>{r.gd > 0 ? "+" : ""}{r.gd}</td>
            <td style={{ ...styles.td, fontWeight: 600 }}>{r.pts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FixturesCard({ group, fixtures, teamNames }) {
  return (
    <section style={styles.card}>
      <div style={styles.sectionHead}>
        <h3 style={styles.h3}>{group.name}</h3>
        <span style={styles.sectionSpan}>Round robin</span>
      </div>
      {fixtures &&
        fixtures.map((f) => (
          <div key={f.id} style={styles.fixture}>
            <span>{teamNames[f.team1]}</span>
            <b style={{ textAlign: "center" }}>vs</b>
            <span style={{ textAlign: "right" }}>{teamNames[f.team2]}</span>
          </div>
        ))}
    </section>
  );
}

function SchoolTeamsCard({ school, schoolTeams, onAdd, onRemove, teamInput, setTeamInput, error }) {
  return (
    <section style={styles.card}>
      <div style={styles.sectionHead}>
        <h3 style={styles.h3}>{school} teams</h3>
        <span style={styles.sectionSpan}>{schoolTeams.length}/3 registered</span>
      </div>
      <p style={{ color: "#687385", fontSize: "13px", marginBottom: "20px" }}>
        Register up to 3 teams for {school}. Team names will be added to the tournament.
      </p>
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <input
          type="text"
          value={teamInput}
          onChange={(e) => setTeamInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
          placeholder="Enter team name"
          style={{ ...styles.input, flex: 1, margin: 0 }}
        />
        <button onClick={onAdd} style={{ ...styles.primary, margin: 0 }}>
          Add team
        </button>
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {schoolTeams.length > 0 ? (
        <div style={styles.schoolTeamsList}>
          {schoolTeams.map((team) => (
            <div key={team.id} style={styles.schoolTeamItem}>
              <span>{team.teamName}</span>
              <button onClick={() => onRemove(team.id)} style={styles.removeButton}>
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div style={styles.empty}>No teams registered yet. Add your first team above.</div>
      )}
    </section>
  );
}

const styles = {
  app: {
    minHeight: "100vh",
    fontFamily: "Arial, sans-serif",
    color: "#18212f",
    background: "#f4f6f8",
  },
  header: {
    background: "#0b1f33",
    color: "#fff",
    padding: "22px 5vw",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  h1: {
    fontSize: "26px",
    margin: 0,
  },
  eyebrow: {
    fontSize: "11px",
    letterSpacing: ".14em",
    textTransform: "uppercase",
    opacity: 0.7,
    marginBottom: "5px",
  },
  switch: {
    display: "flex",
    background: "#19334d",
    borderRadius: "12px",
    padding: "4px",
    gap: "4px",
  },
  switchButton: {
    border: 0,
    background: "transparent",
    color: "#fff",
    padding: "9px 14px",
    borderRadius: "9px",
    cursor: "pointer",
    fontSize: "13px",
  },
  hero: {
    background: "#fff",
    padding: "42px 5vw 34px",
    borderBottom: "1px solid #e4e8ed",
  },
  heroH2: {
    fontSize: "34px",
    margin: "0 0 8px",
  },
  heroP: {
    margin: 0,
    color: "#687385",
    fontSize: "14px",
  },
  live: {
    display: "inline-block",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: ".1em",
    borderRadius: "99px",
    padding: "5px 9px",
    background: "#e9f7ef",
    color: "#18794e",
  },
  pill: {
    display: "inline-block",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: ".1em",
    borderRadius: "99px",
    padding: "5px 9px",
    background: "#e9f7ef",
    color: "#18794e",
    marginBottom: "8px",
  },
  tabs: {
    padding: "0 5vw",
    background: "#fff",
    borderBottom: "1px solid #e4e8ed",
    display: "flex",
  },
  tabButton: {
    border: 0,
    background: "transparent",
    color: "#687385",
    padding: "15px 4px",
    marginRight: "28px",
    cursor: "pointer",
    fontSize: "14px",
    borderBottom: "3px solid transparent",
  },
  tabActive: {
    color: "#0b1f33",
    borderBottom: "3px solid #0b1f33",
  },
  grid: {
    maxWidth: "1200px",
    margin: "auto",
    padding: "28px 5vw",
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "18px",
  },
  gridSingle: {
    maxWidth: "1200px",
    margin: "auto",
    padding: "28px 5vw",
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "18px",
  },
  gate: {
    minHeight: "calc(100vh - 80px)",
    display: "grid",
    placeItems: "center",
    padding: "30px",
    background: "radial-gradient(circle at top, #dcebf4, #f4f6f8 55%)",
  },
  gateCard: {
    background: "#fff",
    width: "min(480px, 100%)",
    padding: "38px",
    borderRadius: "22px",
    boxShadow: "0 18px 50px rgba(12, 32, 52, 0.12)",
  },
  logo: {
    width: "48px",
    height: "48px",
    borderRadius: "12px",
    background: "#0b1f33",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
    marginBottom: "24px",
    fontSize: "16px",
  },
  gateH2: {
    fontSize: "31px",
    margin: "12px 0 8px",
  },
  gateP: {
    color: "#697587",
    margin: "0 0 28px",
    fontSize: "14px",
  },
  form: {
    display: "grid",
    gap: "16px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 600,
    display: "block",
    marginBottom: "4px",
  },
  input: {
    width: "100%",
    padding: "12px 13px",
    border: "1px solid #ccd3db",
    borderRadius: "9px",
    marginTop: "6px",
    background: "#fff",
    font: "inherit",
    fontSize: "13px",
  },
  error: {
    fontSize: "12px",
    color: "#d63031",
    margin: "4px 0 8px",
  },
  checkLabel: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    fontWeight: 400,
    color: "#586475",
    fontSize: "13px",
  },
  primary: {
    border: 0,
    borderRadius: "10px",
    padding: "12px 17px",
    fontWeight: 700,
    cursor: "pointer",
    background: "#0b1f33",
    color: "#fff",
    fontSize: "14px",
  },
  primaryWide: {
    width: "100%",
    border: 0,
    borderRadius: "10px",
    padding: "12px 17px",
    fontWeight: 700,
    cursor: "pointer",
    background: "#0b1f33",
    color: "#fff",
    fontSize: "14px",
    marginTop: "4px",
  },
  secondary: {
    border: 0,
    borderRadius: "10px",
    padding: "12px 17px",
    fontWeight: 700,
    cursor: "pointer",
    background: "#edf1f4",
    color: "#172230",
    fontSize: "14px",
  },
  choiceButton: {
    border: "1px solid #d4dbe2",
    borderRadius: "9px",
    padding: "10px 13px",
    background: "#fff",
    color: "#4c5867",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "13px",
  },
  chosenButton: {
    background: "#0b1f33",
    color: "#fff",
    borderColor: "#0b1f33",
  },
  small: {
    display: "block",
    color: "#8a94a1",
    marginTop: "18px",
    fontSize: "12px",
  },
  adminBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "32px 5vw",
    background: "#fff",
    borderBottom: "1px solid #e4e8ed",
  },
  adminH2: {
    fontSize: "22px",
    margin: "0 0 4px",
  },
  adminP: {
    margin: "4px 0 0",
    color: "#687385",
    fontSize: "13px",
  },
  card: {
    background: "#fff",
    border: "1px solid #e1e6eb",
    borderRadius: "16px",
    padding: "20px",
    boxShadow: "0 4px 16px rgba(20, 35, 50, 0.04)",
  },
  h3: {
    fontSize: "16px",
    margin: "0 0 8px",
    fontWeight: 600,
  },
  h4: {
    fontSize: "15px",
    margin: "22px 0 5px",
    fontWeight: 600,
  },
  sectionHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "15px",
  },
  sectionSpan: {
    fontSize: "12px",
    color: "#778291",
  },
  match: {
    display: "grid",
    gridTemplateColumns: "1fr 52px 20px 52px 1fr",
    gap: "8px",
    alignItems: "center",
    padding: "9px 0",
    borderBottom: "1px solid #edf0f3",
    fontSize: "13px",
  },
  scoreInput: {
    width: "52px",
    padding: "9px",
    border: "1px solid #ccd3db",
    borderRadius: "7px",
    textAlign: "center",
    fontSize: "13px",
  },
  matchVs: {
    textAlign: "center",
    color: "#8b95a2",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "14px",
  },
  th: {
    textAlign: "center",
    color: "#8993a0",
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: ".08em",
    padding: "10px 7px",
    borderBottom: "1px solid #edf0f3",
  },
  td: {
    padding: "10px 7px",
    borderBottom: "1px solid #edf0f3",
    textAlign: "center",
  },
  fixture: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 1fr",
    gap: "10px",
    padding: "12px 0",
    borderBottom: "1px solid #edf0f3",
    fontSize: "13px",
  },
  regsList: {
    display: "grid",
    gap: "10px",
  },
  regItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "12px",
    background: "#f7f8fa",
    borderRadius: "9px",
  },
  regSpan: {
    color: "#6c7785",
    fontSize: "13px",
  },
  empty: {
    padding: "24px",
    background: "#f7f8fa",
    borderRadius: "10px",
    color: "#778291",
    textAlign: "center",
    fontSize: "13px",
  },
  schoolTeamsList: {
    display: "grid",
    gap: "8px",
  },
  schoolTeamItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px",
    background: "#f7f8fa",
    borderRadius: "9px",
    fontSize: "13px",
  },
  removeButton: {
    border: "1px solid #ccd3db",
    background: "#fff",
    borderRadius: "6px",
    width: "28px",
    height: "28px",
    cursor: "pointer",
    fontSize: "14px",
    color: "#d63031",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  teamList: {
    display: "grid",
    gap: "8px",
    marginTop: "12px",
  },
  teamCheckList: {
    display: "grid",
    gap: "6px",
    maxHeight: "220px",
    overflowY: "auto",
  },
  teamCheckItem: {
    display: "flex",
    alignItems: "center",
    padding: "8px 10px",
    borderRadius: "8px",
    fontSize: "13px",
    cursor: "pointer",
    border: "1px solid #e1e6eb",
    background: "#fff",
  },
  teamCheckItemSelected: {
    background: "#eaf2fb",
    border: "1px solid #0b1f33",
  },
  teamCheckItemDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  teamItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    background: "#f7f8fa",
    borderRadius: "8px",
    fontSize: "13px",
  },
};
