# Cardio Objective Engine — Evidence & Personalization Model

Version: `CARDIO_EVIDENCE_2026_09_V2`

## Purpose

The Cardio Objective engine must not be a shallow lookup table or a free-form AI coach. It is a versioned hybrid decision system:

1. **Safety gate** blocks or constrains the flow when required.
2. **Canonical training history** summarizes what the person actually did in the last 7/28 days when trustworthy data exists.
3. **Deterministic profile classification** combines real history, sport background and declared capability.
4. **Research-backed principles** define how each class should be treated.
5. **Invictus product guardrails** convert those principles into bounded mission ranges.
6. **Gemini may refine only inside the deterministic bounds**.
7. **The deterministic validator runs again** before persistence.
8. **Weekly real-world response** (completion, difficulty, energy, confidence and barriers) changes the next step.

The AI is never the authority for modality, safety, mission minimums, distance validity or progression bounds.

## Evidence hierarchy

The engine prefers evidence in this order:

1. international/public-health guideline;
2. professional exercise-prescription guideline;
3. systematic review/meta-analysis;
4. peer-reviewed review/observational evidence;
5. Invictus product heuristic, clearly labelled as such.

The code must not pretend that an Invictus product threshold is a number directly prescribed by a paper.

## Current evidence registry

### WHO 2020 — physical activity and sedentary behaviour

Source: https://www.who.int/publications/i/item/9789240015128

Used for:
- some activity is better than none;
- inactive adults should begin with small amounts and gradually increase frequency, intensity and duration;
- the broad adult public-health target is 150–300 minutes/week of moderate aerobic activity or equivalent.

The WHO target is a population health recommendation, **not** the first-mission duration.

### CDC — getting started with physical activity

Source: https://www.cdc.gov/healthy-weight-growth/physical-activity/getting-started.html

Used for:
- start slowly;
- fit activity into a realistic routine;
- progress toward more time or more challenging activity.

### ACSM — FITT-VP / exercise prescription principles

Source: https://www.acsm.org/docs/default-source/publications-files/acsms-exercise-testing-prescription.pdf

Used for:
- frequency, intensity, time, type, volume and progression all matter;
- prescription should be individualized rather than based on one number.

### Endurance training intensity distribution

Sources:
- https://pubmed.ncbi.nlm.nih.gov/20861519/
- https://pubmed.ncbi.nlm.nih.gov/39888556/
- https://pubmed.ncbi.nlm.nih.gov/37964776/

Used for:
- trained endurance athletes usually accumulate a large proportion of their work at low intensity;
- pyramidal and polarized distributions are both seen in high-level sport;
- there is no single distribution that should be blindly assigned to every trained athlete;
- Invictus therefore does **not** automatically add high-intensity work merely because someone is classified as advanced.

### Running load / progression uncertainty

Source: https://pubmed.ncbi.nlm.nih.gov/34478518/

Used for:
- evidence linking a single fixed progression percentage to injury risk is inconsistent;
- the engine must not encode the popular `10% rule` as a universal scientific law;
- progression is therefore bounded, small, profile-dependent and adjusted using the user’s weekly response.

### Individualized load progression

Source: https://bjsm.bmj.com/content/55/17/947

Used for:
- current sport-specific capacity matters when progressing training load;
- load should be interpreted in the context of what the athlete is already tolerating;
- a single detached workload number should not replace individualized decision-making.

### Recent-vs-prior workload ratios

Source: https://pubmed.ncbi.nlm.nih.gov/41029871/

Used for:
- recent/prior workload ratios can provide descriptive context;
- methods and thresholds vary substantially across studies;
- the engine must **not** treat any ratio band as a universal injury-risk threshold, diagnosis, proof of overtraining or proof of insufficient recovery.

## Product guardrails vs. research claims

### 15-minute active-mission floor

Invictus uses **15 minutes** as the normal floor for an active cardio mission because the product goal is to avoid challenges so trivial that they are indistinguishable from ordinary daily movement (for example, 8 minutes of walking for an otherwise healthy adult).

This is an **Invictus product rule**, not a claim that WHO/ACSM define 15 minutes as a universal physiological minimum.

Safety/medical-return flows are different: when the safety gate blocks progression, the system should pause/refer rather than bypass the rule with an arbitrary tiny workout.

### Exact profile fractions and load bands

Fractions such as the portion of available time or observed session length used for the initial mission are **versioned product heuristics** informed by the evidence principles above. They are not quoted as exact research prescriptions.

The `declining`, `stable`, `rising` and `spiking` load labels are also product heuristics. They describe the relationship between the last 7 days and the preceding 7 days only when enough valid data exists. They do **not** estimate injury probability or physiological recovery.

## Source priority for personalization

When inputs disagree, the motor uses this order:

1. safety gate;
2. canonical completed activity history when sufficient;
3. explicit current sport/training background and capability answers;
4. practical availability and adherence barriers;
5. conservative fallback when history is unavailable or insufficient.

Real history does not erase legitimate external training. A person may train outside Invictus/Health sources, so self-report remains meaningful when canonical history is incomplete.

## Real training-history model

For eligible completed cardio in the 28-day window, the engine calculates:

- sessions in the last 7 and 28 days;
- active days in the last 7 and 28 days;
- minutes in the last 7 days;
- minutes in the preceding 7 days;
- total minutes in 28 days;
- average session duration in 28 days;
- longest session duration in 28 days;
- last eligible cardio timestamp and days since that activity;
- a descriptive 7-day load ratio only when both periods contain enough activity.

Activities in the future, invalid durations, security-blocked records and rejected/suspicious activities are excluded. A failed history query is `unavailable`, never interpreted as zero training.

The history has two jobs:

1. prevent a capable user from receiving a trivial mission because of a shallow questionnaire answer;
2. prevent automatic escalation when the person has already increased recent volume substantially.

It does **not** diagnose fatigue, overtraining, injury risk or readiness. Specific physiological recovery remains unknown unless the product later gains a validated recovery model with appropriate inputs.

## Inputs used to characterize the person

New journeys collect and combine:

- declared walking capacity;
- running ability;
- broader training background: inactive, occasional, regular, structured or competitive;
- primary sport: running, cycling, team sport, combat sport, functional/cross training, other or none;
- typical duration of a cardio/sport session;
- time actually available for the Invictus mission;
- days available and preferred schedule;
- preferred cardio modality;
- main adherence barrier;
- confidence in maintaining the plan;
- canonical 7/28-day activity history when available;
- safety answers.

This separation is important: **not being a runner is not the same thing as being sedentary**. A competitive cyclist, fighter or team-sport athlete must not receive a sedentary fallback merely because they report little running experience.

## Profile classes

### `sedentary`

Typical signals:
- cannot run yet;
- low comfortable walking capacity;
- no meaningful recent cardio history;
- no regular sport/training background.

Engine behavior:
- easy intensity;
- minimum useful mission (15 min normal floor);
- no artificial high intensity;
- gradual progression only after real adherence.

### `beginner`

Typical signals:
- some walking capacity;
- seconds of running, occasional sport or a small amount of recent cardio.

Engine behavior:
- easy intensity;
- modest but non-trivial starting dose;
- run/walk may be appropriate when running is the chosen modality;
- small progression.

### `active`

Typical signals:
- can run for some minutes, has recurring recent cardio, or reports regular/structured sport outside running.

Engine behavior:
- mission must be meaningfully above sedentary fallback;
- observed average/longest sessions can anchor the initial dose;
- modality should respect the user’s real capability, sport and goal;
- availability is a ceiling, not proof of capacity;
- a non-runner athlete is not downgraded to sedentary by default.

### `runner`

Typical signals:
- reports regular running and/or has consistent recent running history.

Engine behavior:
- do not regress to a short walking mission without a clear return/safety reason;
- continuous running is preserved by default;
- meaningful fraction of the observed/declarative session capacity is used;
- automatic intensity remains easy initially.

### `advanced`

Typical signals:
- competitive sport background;
- structured high-volume endurance context;
- structured running and/or high, consistent recent endurance history.

Engine behavior:
- preserve a substantial mission duration;
- do not use beginner run/walk intervals for trained runners;
- preserve the chosen sport modality for non-runners;
- do not automatically prescribe HIIT;
- use mostly easy automatic work until the product has enough information about recent load, recovery and training phase to justify more complex intensity decisions.

### `returning`

Typical signals:
- explicit return-cardio goal;
- restart barrier after previous regular/structured training;
- surgical/medical return routes handled by the safety gate.

Engine behavior:
- recognize prior ability but reduce the starting load;
- do not treat the person as lifelong sedentary;
- progression depends on actual weekly response.

## Internal decision questions

Every initial journey stores a decision trace answering at least:

1. Is there a safety reason to block or constrain training?
2. Is the person sedentary, beginner, active, regular runner, advanced/competitive or returning?
3. What did the person actually do in the last 7 and 28 days?
4. Did recent volume rise sharply relative to the preceding 7 days, with enough data to make that comparison?
5. Does the person practice another sport with meaningful cardiovascular demand?
6. What continuous capacity is declared/observed?
7. What is the actual goal (health, consistency, run distance, performance, return)?
8. What time/days really fit the routine?
9. What barrier most threatens adherence?
10. Is there enough information to claim physiological recovery? (normally no at onboarding)
11. If trained, should intensity automatically be increased? (default: no)
12. Is there a universal evidence-based safe percentage or workload-ratio threshold? (no)

The trace includes evidence IDs and is persisted in the baseline so a mission can be audited later.

## Personalization authority

### Deterministic engine owns

- safety gates;
- profile class;
- canonical history summary;
- modality validity;
- duration/distance bounds;
- minimum mission floor;
- interval-vs-continuous structure;
- number of sessions;
- progression/regression limits;
- evidence version and trace.

### AI may do

- choose a duration **inside** the allowed range for duration-based initial missions;
- use sport/training/history context to select the most coherent point inside that range;
- write a short personalized rationale;
- later, phrase weekly explanations naturally.

### AI may not do

- override safety;
- change the sport modality outside deterministic rules;
- create a duration below the floor or above the cap;
- invent a research source;
- treat a non-running athlete as sedentary when the deterministic engine classified otherwise;
- turn a load trend into an injury/overtraining/recovery diagnosis;
- add HIIT to an advanced athlete without deterministic permission;
- promise outcomes or diagnose conditions.

## Weekly adaptation

The next mission is based on actual response, not only the onboarding identity.

Signals include:
- adherence/completion;
- perceived difficulty;
- energy;
- confidence;
- relevant barriers;
- safety answers;
- verified activity completion.

A good week can produce a small progression. A difficult week can regress. At the 15-minute floor a regression can become `maintain` instead of creating an 8–12 minute trivial mission.

Profile-specific progression rates are product guardrails. They intentionally avoid a universal fixed percentage.

## Research maintenance

Before changing `CARDIO_RESEARCH_VERSION`:

1. review WHO/ACSM guidance for updates;
2. search systematic reviews/meta-analyses published since the current version;
3. specifically review evidence for inactive adults, novice exercisers, recreational athletes, cross-sport athletes and trained/elite endurance athletes;
4. review evidence around workload monitoring without converting uncertain associations into universal risk thresholds;
5. document what changed and why;
6. add/update regression tests for each affected profile;
7. never silently change historical journeys — their evidence version remains attached to the baseline used at creation.

Recommended review cadence: at least every 6 months, and immediately before introducing automated high-intensity prescriptions, recovery/load models or new athlete classes.
