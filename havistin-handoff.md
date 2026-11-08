# Sending a user from Havistin to Terra

Terra does not have its own login. A user signs in on Havistin, and Havistin sends them to Terra with the FinBIF person token already in the Havistin session (`session["token"]`).

Terra and Havistin are different sites, so the Havistin session cookie is not visible to Terra. Pass the token explicitly. Do not put it in a link.

## Addresses

| | Havistin | Terra login |
|---|---|---|
| Local | http://localhost | http://localhost:85/login |
| Production | https://havistin.biomi.org | https://terra.biomi.org/login |

Havistin stays on port 80. Terra uses port 85 locally, so both can run at the same time.

## What to build

Add a page in Havistin, shown only when `session["token"]` is present. If the user is not logged in, send them through Havistin's normal login first.

The page contains a form that posts to Terra and submits itself. This is the same pattern as `app/templates/login_relay.html`.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="referrer" content="no-referrer">
    <title>Opening Terra</title>
</head>
<body>
    <p>Opening Terra…</p>
    <form id="terra-login" action="{{ terra_login_url }}" method="post">
        <input type="hidden" name="personToken" value="{{ person_token }}">
        <noscript>
            <button type="submit">Continue to Terra</button>
        </noscript>
    </form>
    <script>
        document.getElementById("terra-login").submit();
    </script>
</body>
</html>
```

`terra_login_url` is the Terra login address from the table above. `person_token` is `session["token"]`.

Terra accepts one form field:

- `personToken` — the FinBIF person token

No other fields are required. Terra calls FinBIF `/person` itself and stores the token and the person id in its own cookie. The browser then lands on Terra's front page.

Use POST. Terra also accepts `personToken` as a query parameter, but the token then appears in the address bar, browser history, and access logs. Terra redirects away from that URL immediately; prefer the form anyway.

A normal form navigation needs no CORS setup. Do not send the token with `fetch`.

## Shared token

The token is the same one Havistin uses. Do not create a second token for Terra, and do not revoke it when the user leaves for Terra.

Havistin's logout revokes the person token at FinBIF. After that, Terra's copy of the token stops working on the next FinBIF call. That is expected. Terra's own logout only clears Terra's cookie and does not revoke the token, so it does not log the user out of Havistin.
