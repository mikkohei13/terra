This is a draft plan for interpreting an observation's notes into structured fields that can be sent to FinBIF Vihko.

Save stays instant. The phone stores the observation as it does now, then quietly interprets the notes. The observation list updates in place when an answer comes back. Nothing blocks making the next observation.

Backend calls an OpenAI LLM over an API. The provider is not chosen yet. The model api key stays in the server environment.

# What the user does

The entry dialog stays as it is: taxon, count, notes, accuracy, plus the new fields. In bird search, picking a name already puts the phrase into notes (`Sinisorsa yksi koiras kaksi naarasta paikallisia`). Save closes the dialog and returns to the map.

The new fields are on the create dialog too. When observation is saved and notes are non-empty and new, then count, both sex counts, moving status, and plumage are cleared, including values just typed, and then interpretation fills them. With empty notes, nothing is cleared and nothing is sent: the typed fields stay.

Empty notes, or notes that are only whitespace, skip interpretation.

New fields:

- maleIndividualCount: a positive integer, or empty
- femaleIndividualCount: a positive integer, or empty
- movingStatus: zero or more codes from the list below
- birdPlumage: zero or one of ad, juv, pull, subad, jp
- interpretationState: pending, done, or failed. Empty when the row was not interpreted.

If user adds anything to any of these fields, the notes are not sent to the LLM for interpretation. The app should not overwrite what user has entered into these fields.

`movingStatus` codes below. Replace each code with the exact string Vihko should store. Each code can be in the array no more than once. The validator, and the document builder use this list and no other status codes.

"P",
"M",
"kiert",
"Ä",
"Än",
"än",
"ä"

On the Vihko unit, Terra sends:

| Phone field | Unit field | Value sent |
| --- | --- | --- |
| count | count | the abundance text, the same way a typed count is sent today |
| maleIndividualCount | maleIndividualCount | integer |
| femaleIndividualCount | femaleIndividualCount | integer |
| movingStatus | movingStatus | list of the exact strings from the list above |
| birdPlumage | birdPlumage | adult → MY.birdPlumageAd, juvenile → MY.birdPlumageJuv, pullus → MY.birdPlumagePull |
| notes | notes | the original notes, unchanged |

Bookkeeping stays on the phone: `interpretationState`. The document builder ignores that key.

A blank structured field is left out of the unit.

Count is a string of what the LLM returns, for example "1,3".

Sex counts stay in their own integer fields.

The map list and the nearby-observation list use the same summary.

- Skipped: this is used when user has entered something into the details fields, which causes the LLM interpretation to be skipped.
- Pending: the notes stay visible, and a muted "Interpreting" sits with them.
- Done.
- Failed: the notes stay, and a muted "Not interpreted" sits with them. No alert and no dialog.

Review is optional for the user. The user can correct any of the fields. Editing an existing observation does not trigger a new call to the LLM.


# How it works

The observation stays in IndexedDB. New properties on the same record:

- interpretationState: pending, done, or failed

A single runner sends pending records to backend one at a time while the active session is on screen, on the map and on the document step. The request is the taxon name and the notes. Backend returns JSON. The phone applies it only when that observation still exists.

The state is on the record, so it survives a locked phone.

Each model call waits at most 20 seconds. While the session stays open, a network failure, a timeout, or a "try again" response stays pending. An answer that is not a usable object becomes failed. The runner then moves to the next pending row. Changing the notes is what starts a new interpretation.

## Cases the runner has to respect

The user saves a second observation before the first answer returns. The first answer still lands on the first row. One request is in flight at a time.

The user deletes an observation while its request is in flight. Drop the answer.

Male and female counts need not add up to count, and count may be a phrase rather than a single number, for example "5,2".

A value the schema does not know is ignored. One bad field does not fail the whole row.

# What the interpreter extracts

The model sees the taxon name and the notes. The taxon is context, so a note that is only behavior still belongs to the chosen species. The taxon is not an output, and interpretation never changes it.

The note can be assumed to be in Finnish, including number words and the usual abbreviations.

# LLM call

Interpretation by the LLM should done only once: when the observation is saved.

The body is the taxon name, and the notes concatenated with a space, nothing else. The server stores nothing.

Before sending the body to the API, do simple preprocessing on Terra backend. It should do these replacements:

naaras puku -> naaraspuku
koiras puku -> koiraspuku
juhla puku -> juhlapuku

Schema document is in ./temp/schema.json. You may copy this to wherever appropriate.

Prompt document is in ./temp/prompt.txt. You may copy this to wherever appropriate.

Use these settings:
MODEL = "gpt-6-luna"
REASONING_EFFORT = "low"

Here is sample script to use the API with:

def call_openai(client: OpenAI, prompt: str, schema: dict, user_text: str) -> tuple[dict, dict]:
    response = client.responses.create(
        model=MODEL,
        reasoning={"effort": REASONING_EFFORT},
        input=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_text},
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "bird_observation",
                "strict": True,
                "schema": schema,
            }
        },
    )
    if not response.output_text:
        raise RuntimeError("Empty model output (possible refusal)")
    return json.loads(response.output_text), usage_from_openai(response)


# Validation

Python is the gate. It runs on the model object before the phone sees it.

- Unknown keys are ignored.
- A field of the wrong type, or outside its allowed values, is dropped. The other fields stay.
- Status codes are filtered to the allowed list, converted to FinBIF schema strings, de-duplicated. Order of the keys is not important.
- Count is trimmed text. Empty text is dropped. The sex counts accept an integer, or a string of digits, and drop anything else (`n. 10`, `5-10`, `pari`, `0`, negatives, fractions).
- After the normalization above, the result is a success even when no field remains.

# Tests

Unit tests cover the validator and the document mapping, with the model replaced by a fixture. They do not call a live model.

