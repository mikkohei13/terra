# Note interpretation: cases to decide

Reviewed against the current phone save rules (`observe.js`), the runner (`interpret-runner.js`), the server validator and prompt (`app/interpret/`), and the Vihko mapping (`document.py`). No app code was changed.

Each case says what the app does today. The groupings are bugs, then situations the rules handle in a way that is easy to miss or easy to store wrong.

## Bugs

### 1. The answer and a save are two separate read-then-write steps

The runner and Save both read the whole observation, change a copy, and `put` that copy back. Nothing ties the read to the write, and neither write is conditional on the row still matching what was read.

A realistic overlap:

1. The row is pending with notes `2 ä`. The request is in flight.
2. Save reads that row. The user has changed the notes to `3 ä`.
3. The answer arrives and also reads the pending row. Taxon and notes still match what was sent, so the answer is accepted.
4. Save writes notes `3 ä` and clears `interpretationState`.
5. The answer then writes its copy: notes `2 ä`, count `2`, moving status `Ä`, state `done`.

The edit is gone, and the old notes have been interpreted. The same pattern the other way around: Save read a pending row, the answer wrote `done` and a count, then Save wrote the stale pending copy back on top. The count disappears and the row is requested again.

Delete has the same shape. The answer reads the row, Delete removes it, the answer `put`s the row back. The observation returns on the list, with interpreted fields, after the user confirmed the delete.

Clearing the session (submit, send later, discard, or starting another session) is safe when the answer arrives only after the row is already gone: the runner sees no pending row and drops the body. It is not safe when the runner has already read the row and the clear happens before its `put`. That `put` creates the observation again. `startSession` clears storage before it saves the new session, so a `put` that lands after that save attaches the old observation to the new session.

Leaving the map does not cancel the request. `stop()` only tells the loop not to start another one. The request that is already running still writes when it finishes.

### 2. An open dialog does not show an answer that arrives while it is open

The form is filled once, when the dialog opens. The list behind it can update, but the inputs stay as they were. On a phone the dialog covers that list.

Two saves follow from that, with no race required:

- The user changes nothing about taxon, notes, or the structured fields, and taps Save (for example after changing accuracy or the pin). Save keeps the latest stored row, including fields that are not on screen. Count, sex, moving status, and plumage are kept even though the form still shows them empty.
- The user changes the notes or the taxon. Save writes the form. The structured inputs are still empty, so they overwrite the answer that just arrived. `interpretationState` is left as `done` when the answer got there first, because only a still-pending row has its state cleared. The row will not be interpreted again. The list then shows no status word, which looks the same as a note that was never sent.

Closing the dialog without saving leaves the stored answer alone.

### 3. `failed` sticks, and it hides later edits

`interpretationState` is cleared only when a **pending** row is edited in taxon, notes, or a structured field. A `failed` row keeps `failed` through every later save. An edit never sets `pending`.

So:

- The user fixes the notes after "Not interpreted". The new notes are stored. No request is sent. The label stays "Not interpreted".
- The user types the count and the sex by hand on that same row. Those values are stored and will be submitted. The label still says "Not interpreted", because `failed` is checked before the fields.

The only way to get a new request is to delete the observation and add it again.

### 4. "Skipped" is also shown when there was nothing to interpret

The list adds **Skipped** whenever `interpretationState` is absent and any of count, males, females, moving status, or plumage is filled. Notes are not consulted.

A count typed alone, with the notes box empty, shows **Skipped**. So does every hand-filled row. A row that was skipped because the notes really did contain "2 koirasta" looks the same as a row where the user simply typed a count.

A row saved before this feature existed, with a count and no `interpretationState`, gets the same word.

## The result is easy to submit without seeing it

The map list shows taxon and, when present, count. The grey word is only Interpreting, Not interpreted, or Skipped. Males, females, moving status, and plumage never appear there. The map pin tooltip is the taxon only. The document step lists no observations at all, while the runner is still allowed to run on that screen.

Consequences:

- Notes `laulava` become moving status `Ä` and no count. **Interpreting** disappears and the row looks as it did before the request. The `Ä` is visible only if the user opens Edit.
- An answer that fills only plumage or only a sex count is equally quiet. Count is the one interpreted value the list shows, as `Talitiainen · 2`.
- Submit does not wait. On the document screen there is no Interpreting / Not interpreted line, so a pending or failed row is easy to send as notes only. The submission uses the rows read at the start of submit. An answer that lands while the POST is in flight is not in that body, and a successful submit then clears the session, so that answer is dropped if its write has not already happened (see case 1 when it has).

There is no stored mark that a field came from the model. `interpretationState` is removed before Vihko. Notes are sent as well as the structured fields. The document keyword `llm` in the readme todo is not written. On laji.fi a wrong sex or a wrong `Ä` looks like something the observer typed. The original sentence is still in `unit.notes`, so the two can disagree, and both are stored.

`done` with an empty object is a success. The model can return null for every field, the phone stores `done`, and the list shows no status word. That is the same appearance as notes that were never a candidate. The server treats a non-object, or a model response with no text, as a failure (`502`, then **Not interpreted**). A usable object that simply has no usable fields does not.

## When a request is never sent

A request is started only on the first save of a new observation, and only when the notes are non-blank and count, males, females, moving status, and plumage are all empty. Anything else stores the typed values and, if a structured field is filled, shows **Skipped**.

Concrete gaps:

- Notes added on a later edit are stored and never sent. The first save had an empty notes box.
- The user clears the count that caused **Skipped**, and leaves `2 koirasta` in notes. The row is saved with notes and no structured fields. State stays absent. No request.
- The user fills one structured field and leaves the rest to the notes. Count `2` plus notes `koiras ä` saves the count and skips sex and moving status. `Ä` pressed, notes `5`, skips the count. The rule is all five empty, or no request at all.
- The user changes taxon or notes while the row is still pending. The state is removed so the in-flight answer will be dropped if it loses the race in case 1. The edited notes are not sent as a new request.
- The user changes only accuracy or the pin while the row is pending. The state stays pending, and the original request may still be applied. That part matches the rule. It is the case 2 dialog that makes the filled fields invisible.
- Free text saved from the taxon box without tapping a suggestion stays the taxon string. Mode B copies trailing words into notes only when a hit is chosen. `talitiainen 2 ä` saved without a tap has empty notes, so there is no request, and the count is inside the species name that goes to Vihko.
- Tapping a mode B hit replaces the whole notes box. It does not append. Notes the user had already typed are replaced. On an edit of a pending row, that replacement is a notes change, so the pending state is cleared if they then save.

### Mode B keeps a different string than "the words after the name"

For a chosen hit, the notes stored are the matched name, a space, and the tail. The model is then given taxon, a space, and those notes, so the name is in the user message twice. Vihko `unit.notes` also starts with the species name.

Traced with the same prefix distance the phone uses, against the name `talitiainen`:

| Typed in the taxon box | Taxon after the tap | Notes stored | Request |
| --- | --- | --- | --- |
| `talitiainen 2 ä` | `talitiainen` | `talitiainen 2 ä` | Yes. User message `talitiainen talitiainen 2 ä`. |
| `2 talitiainen` | `talitiainen` | none | No. The leading `2` is consumed as a typo on the name. |
| `2 talitiainen ä` | `talitiainen` | `talitiainen ä` | Yes, but the `2` is gone, so the model never sees the count. |
| `ä talitiainen` | `talitiainen` | none | No. The leading `ä` is consumed the same way. |
| `talitiainen2` | `talitiainen` | none | No. Without a space, the digit is part of the name match. |
| `sinitiainen 2 talitiainen 3` | `sinitiainen` | `sinitiainen 2 talitiainen 3` | Yes. One observation. The model is asked to structure both species into the sinitiainen's fields. |

Leading junk is dropped because the matcher scores a prefix of the typed text against the name, and only the unmatched tail becomes notes. A cheap extra character in front of a long name still matches.

## What gets stored when the model does answer

The validator drops a bad field and keeps the others, then the phone marks the row `done`. It does not record which fields were dropped. A later edit will not ask again.

- **One bad count group drops every group.** `countArray` must be a non-empty list of positive integers. Any other item (`0`, `1.5`, `true`, a string `"1"`) discards the whole list, including the valid numbers. Sex counts are looser: a digit string such as `"4"` is kept. The test fixture `[1, 0]` plus female `"2"` becomes female `2` and no count, and that is a successful `done`.
- **Ranges and hedged amounts become a bare integer.** The prompt says to use the lower bound: `5-10` → `5`, `ainakin 10` → `10`, `n. 50` → `50`. The notes still contain the original words. The unit gets an exact `count` and the original sentence together. `paljon`, `muutama`, and `pari` are instructed to come back null.
- **`pari` is grouped with the vague words.** In notes, `pari` is often a pair, one male and one female. The prompt tells the model to return null, the same as for `paljon`. A note that is only `pari` becomes `done` with no count and no sex, and the list goes quiet.
- **Several groups become a comma string, and plumage does not.** The prompt says one integer per group and not to sum them. `2 ad, 1 juv` can become count `2,1` with plumage null, because the schema says more than one plumage value must be null. `2,1` is also a natural reading of "2 males, 1 female". Age groups and sex groups end up in the same `unit.count` text. Sex fields are separate integers and are not checked against that text. The document test itself sends count `1,3` with male `1` and female `2`, and the unit keeps all three.
- **Nothing checks the fields against each other.** Male plus female can exceed the count. `koiraspukuinen` can be stored as plumage `kpuk` and also as a male count; the prompt says not to, the validator does not remove it. `p` and `m` can both be stored, and so can `Ä` and `ä` together. Codes are de-duplicated and otherwise kept in model order.
- **A missing diacritic drops the status.** Moving status must be exactly `p`, `m`, `kiert`, `Ä`, `Än`, `än`, or `ä`. `A`, `An`, or `a` is dropped and the rest of the answer is still `done`. Plumage must be exactly `ad`, `jp`, `juv`, `kpuk`, `npuk`, `pull`, or `subad`. `Ad` or `1kv` is dropped the same way.
- **Zero cannot be stored.** Sex `0` is schema-legal (`minimum: 0`) and the validator removes it. A count group of `0` removes the whole count. "None" and "not mentioned" are both an absent field.
- **The count string has no length check at interpretation time.** Submit rejects a count longer than 300 characters, and that rejection fails the whole session. The interpreter will join as many positive integers as the model returns.

The three note rewrites run only as exact, case-sensitive substrings, and only on the notes: `naaras puku`, `koiras puku`, `juhla puku`. A double space, a capital, a newline, or a hyphen skips the rewrite (`Naaras puku`, `naaras  puku`, `naaras-puku`). `naaras pukuinen` does become `naaraspukuinen`, because the shorter phrase is a prefix of it.

## Notebook language the current fields lose or misread

These are the phrases the prompt and the allow-lists have no explicit place for. The likely outcomes are a null (then a quiet `done`), or a nearest code that is not the same fact.

- **Sex abbreviations.** `2k`, `1n`, `2k1n`, `2k 1n`. The prompt talks about `koiras`, `uros`, and `naaras`. It does not mention `k` / `n`.
- **Glued tokens.** `2p`, `1Ä`, `3m`, `2juv`, `1ad`. Splitting is left to the model. The server does not split them before the call.
- **Pair notation written as numbers.** `1,1` and `2,3` already mean sexes in a lot of notebooks. The app also builds exactly that shape for "groups, do not sum".
- **Calendar-year ages.** `1kv`, `2kv`, `+1kv`, `1-kv`. They are not plumage codes. The nearest allowed values are `juv` and `subad`, which are not the same ages. Dropping them leaves the age only in the notes; mapping them stores a different age.
- **Other plumage words.** `tp` / talvipuku, `vp` / vaihtopuku, `pp`, `e-puk`, eclipse, sulkasato. Same split: drop, or force into `ad` / `kpuk` / `npuk` / `jp`.
- **Inflected plumage.** The prompt says `koiraspukuinen` / `naaraspukuinen` are plumage. Forms such as `naaraspukuista` or `koiraspukuiset` are not mentioned. The rewrite list does not touch them unless they contain the two-word phrase.
- **"Of which".** `5, joista 2 koirasta` can be read as a total of 5 and 2 males, or as groups that must not be summed. The prompt does not say which.
- **More than one species in the notes.** Covered by the mode B example above. The same thing happens if the user types `2 sinitiainen, 3 talitiainen` into the notes box of one observation. There is one taxon and one count string.
- **Direction and the other half of a migration note.** `12 m SW` can become count `12` and moving status `m`. The direction has nowhere to go except the notes, which are kept. `lentää` is not supposed to become `m`; that depends on the model following the prompt.
- **Language.** The prompt says the input is Finnish only. The screen is English. `2 males singing`, or a Swedish note, is sent anyway. An all-null answer is a quiet `done`.

## Failures, retries, and the two 20 second clocks

The phone retries only a timeout (`AbortError` at 20 s), a network error, `429`, and `503`. Anything else marks the row **Not interpreted** and does not try again. That includes:

- `401` when the login cookie has expired. The error is not shown as a login prompt. Each pending row is failed in turn.
- `400` if taxon or notes are blank by the time the server sees them.
- `500`, and a `502` that Terra itself returns for a bad model body.
- An OpenAI status other than `429` or `503`. A `500`, `502`, or `504` from the model is `InterpretError` on the server, then a permanent **Not interpreted** on the phone. A timeout, a connection error, or a rate limit stays pending.

While the map or the document step is on screen and the page is visible, a row that stays pending is tried again 5 seconds after the runner runs out of other pending rows. There is no increasing delay and no stop. A missing `OPENAI_API_KEY` is a fast `503`, so the phone keeps calling, and the list keeps saying **Interpreting**, for as long as that screen is open. Locking the phone or leaving for the start screen pauses the loop. The call already in flight still finishes and still writes (case 1).

The phone aborts at 20 seconds. The server allows the model the same 20 seconds and does not stop the call when the phone hangs up. Gunicorn's timeout is 70 seconds, so the server call can still be running when the phone has already counted the row as retryable and, about 5 seconds later, sends it again. Two model calls for one note overlap. Only the call whose body the phone still accepts can be stored. The model can also return a different object on the second call.

The route is login-gated and stores nothing. It does not apply the notes length limit used at submit (2000), and it does not limit how often a pending row may call it. The phone's own notes box is limited to 2000, so normal use stays inside that. The retry loop is what repeats the call.
