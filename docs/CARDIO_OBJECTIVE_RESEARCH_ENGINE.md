# Cardio Objective Engine — Evidence & Personalization Model

Version: `CARDIO_EVIDENCE_2026_09_V1`

## Purpose

The Cardio Objective engine must not be a shallow lookup table or a free-form AI coach. It is a versioned hybrid decision system:

1. **Safety gate** blocks or constrains the flow when required.
2. **Deterministic profile classification** identifies the current training context.
3. **Research-backed principles** define how the class should be treated.
4. **Invictus product guardrails** convert those principles into bounded mission ranges.
5. **Gemini may refine only inside the deterministic bounds**.
6. **The deterministic validator runs again** before persistence.
7. **Weekly real-world response** (completion, difficulty, energy, confidence and barriers) changes the next step.

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

## Product guardrails vs. research claims

### 15-minute active-mission floor

Invictus uses **15 minutes** as the normal floor for an active cardio mission because the product goal is to avoid challenges so trivial that they are indistinguishable from ordinary daily movement (for example, 8 minutes of walking for an otherwise healthy adult).

This is an **Invictus product rule**, not a claim that WHO/ACSM define 15 minutes as a universal physiological minimum.

Safety/medical-return flows are different: when the safety gate blocks progression, the system should pause/refer rather than bypass the rule with an arbitrary tiny workout.

### Exact profile fractions

Fractions such as the portion of declared available time used for the initial mission are **versioned product heuristics** informed by the evidence principles above. They are not quoted as exact research prescriptions.

## Profile classes

### `sedentary`

Typical signals:
- cannot run yet;
- low comfortable walking capacity;
- no meaningful recent cardio history.

Engine behavior:
- easy intensity;
- minimum useful mission (15 min normal floor);
- no artificial high intensity;
- gradual progression only after real adherence.

### `beginner`

Typical signals:
- some walking capacity;
- seconds of running or a small amount of recent cardio.

Engine behavior:
- easy intensity;
- modest but non-trivial starting dose;
- run/walk may be appropriate when running is the chosen modality;
- small progression.

### `active`

Typical signals:
- can run for some minutes and/or has recurring recent cardio.

Engine behavior:
- mission must be meaningfully above sedentary fallback;
- modality should respect the user’s real capability and goal;
- availability is a ceiling, not proof of capacity.

### `runner`

Typical signals:
- reports regular running and/or has consistent recent running history.

Engine behavior:
- do not regress to a short walking mission without a clear return/safety reason;
- continuous running is preserved by default;
- meaningful fraction of the available session is used;
- automatic intensity remains easy initially.

### `advanced`

Typical signals:
- structured training and/or high, consistent recent endurance volume.

Engine behavior:
- preserve a substantial mission duration;
- do not use beginner run/walk intervals;
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
2. Is the person sedentary, beginner, active, runner, advanced or returning?
3. What continuous capacity is declared/observed?
4. What is the actual goal (health, consistency, run distance, performance, return)?
5. What time/days really fit the routine?
6. What barrier most threatens adherence?
7. If trained, should intensity automatically be increased? (default: no)
8. Is there a universal evidence-based safe percentage for weekly load increase? (no)

The trace includes evidence IDs and is persisted in the baseline so a mission can be audited later.

## Personalization authority

### Deterministic engine owns

- safety gates;
- profile class;
- modality validity;
- duration/distance bounds;
- minimum mission floor;
- interval-vs-continuous structure;
- number of sessions;
- progression/regression limits;
- evidence version and trace.

### AI may do

- choose a duration **inside** the allowed range for duration-based initial missions;
- write a short personalized rationale;
- later, phrase weekly explanations naturally.

### AI may not do

- override safety;
- change the sport modality outside deterministic rules;
- create a duration below the floor or above the cap;
- invent a research source;
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
3. specifically review evidence for inactive adults, novice runners, recreational athletes and trained/elite endurance athletes;
4. document what changed and why;
5. add/update regression tests for each affected profile;
6. never silently change historical journeys — their evidence version remains attached to the baseline used at creation.

Recommended review cadence: at least every 6 months, and immediately before introducing automated high-intensity prescriptions or new athlete classes.
