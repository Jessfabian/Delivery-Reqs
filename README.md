# Delivery Requirements App

Local web app for MMSD that:

- captures delivery requirement case details
- generates an adaptive Delivery Requirements PDF
- prepares both required emails (internal + agency)
- opens Outlook drafts (and optionally sends) from the shared mailbox with attachments

## Run

From this folder:

```bat
Start App.bat
```

or:

```bat
python server.py
```

Open: `http://127.0.0.1:5055`

## Shared mailbox sending

On first run, `config.json` is created.

- `allow_send: false` (default) = draft only (safe default)
- `allow_send: true` = enables immediate send buttons
- `shared_mailbox` should stay set to the MMSD shared mailbox display name used in Outlook

## Adaptive PDF behavior

- Empty requirement rows are omitted from the PDF.
- `TOTAL FUNDS RECEIVED`, `TLIR`, and `1035X` rows only appear when values are non-zero.
- FR2257CA is included only for DocuSign/e-signature scenarios.
- F6445/PAC requirements append the PAC form pages.

## Requirements chips

- Click chips to add/remove coded requirements.
- Selected coded requirements stay above free-typed rows.
- A blank custom row is kept available for quick typing.

## Rebuild embedded assets

Only needed when source PDFs/images change:

```bat
python build_assets.py
```
