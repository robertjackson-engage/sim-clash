# Code signing

The installer is built unsigned unless signing credentials are in the environment. This
page says what that means for a player, how to switch signing on, and what the realistic
options are for one person publishing a free open-source game.

Facts here were checked on the web on 2026-11-23. Prices and rules in this area change
often: follow the links before spending money.

## What an unsigned installer means for a player

- **SmartScreen.** Windows shows "Windows protected your PC". The player chooses **More
  info**, then **Run anyway**. On a managed PC a policy can remove "Run anyway" altogether.
  A self-signed certificate behaves exactly like no signature, so there is no point in one.
- **Reputation.** SmartScreen keeps reputation per file hash and per publisher certificate.
  An unsigned file starts from zero with **every new version**, and nothing carries over.
  Microsoft says it "can take several weeks and hundreds of clean installs". There is no
  form to submit a file for review.
  ([Microsoft: SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation))
- **Smart App Control** (Windows 11, when it is on): unknown unsigned code is blocked, and
  there is no per-app "Run anyway". A new unsigned build has no reputation, so in practice
  it does not run there. Those players need a signed build, the Microsoft Store, or to run
  from source.
  ([Microsoft: Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview))
- **Signing is not a magic switch.** Since 2024 no certificate, EV included, gives instant
  SmartScreen trust. A signed installer still warns at first; the difference is that the
  reputation belongs to the certificate and carries over to the next version, the warning
  names a publisher instead of "Unknown publisher", and Smart App Control accepts it.
  ([Microsoft: code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options))

## Switching signing on

Nothing in the repository holds a secret. `build/electron-builder.cjs` reads the
environment when `npm run dist` runs, prints which route it found, and signs the app, the
installer and the uninstaller. With nothing set it prints `code signing none` and builds
unsigned.

| Route | Set these | Notes |
| --- | --- | --- |
| **Azure Artifact Signing** (was "Trusted Signing") | `AZURE_SIGN_ENDPOINT` (for example `https://eus.codesigning.azure.net`), `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_PUBLISHER` (must equal the certificate's common name exactly), and for sign-in `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Becomes electron-builder's `win.azureSignOptions`. The app registration needs the "Artifact Signing Certificate Profile Signer" role. Build on Windows. |
| **A certificate in the Windows certificate store** (a USB token, a cloud key provider) | `WIN_SIGN_SHA1` (the thumbprint) or `WIN_SIGN_SUBJECT` (the subject name) | Becomes `win.signtoolOptions`. The token must be plugged in, or the provider's software signed in, on the build PC. This is the route for Certum and for ordinary OV certificates. |
| **A `.pfx` / `.p12` file** | `CSC_LINK` (path, URL or base64) and `CSC_KEY_PASSWORD` (or `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`) | electron-builder reads these itself. Publicly trusted certificates are no longer issued as files (see below), so this is only useful for a private or test certificate. |

Add `SIGN_REQUIRED=1` for a release build: it then fails instead of quietly producing an
unsigned installer.

PowerShell, for one build:

```
$env:AZURE_SIGN_ENDPOINT = 'https://eus.codesigning.azure.net'
$env:AZURE_SIGN_ACCOUNT = 'my-signing-account'
$env:AZURE_SIGN_PROFILE = 'my-profile'
$env:AZURE_SIGN_PUBLISHER = 'Jane Doe'
$env:AZURE_TENANT_ID = '...'
$env:AZURE_CLIENT_ID = '...'
$env:AZURE_CLIENT_SECRET = '...'
$env:SIGN_REQUIRED = '1'
npm run dist
```

Check the result (it should say `Valid` and name the publisher):

```
Get-AuthenticodeSignature .\dist\Sim-Clash-Setup-1.0.0-beta.2.exe | Format-List Status, SignerCertificate
```

**Not tested.** None of these routes has been run for this project: there is no
certificate. The configuration follows electron-builder 26's documentation
([code signing on Windows](https://www.electron.build/v26/docs/features/code-signing/code-signing-win)).
Expect to adjust it the first time. Do not sign a release with a self-signed certificate.

## The options for one person and a free game

| Option | Cost | Who can get it | Publisher shown | Lead time | SmartScreen |
| --- | --- | --- | --- | --- | --- |
| **Stay unsigned** | 0 | anyone | Unknown publisher | none | warns on every version; blocked under Smart App Control |
| **Microsoft Store** (MSIX) | 0: individual developer accounts have been free since September 2025 | individuals in most countries, with ID and selfie verification | your Store publisher name | account verification, then certification of each submission | no warning: Microsoft signs and hosts the package |
| **SignPath Foundation** | 0 | open-source projects that meet its conditions | "SignPath Foundation" | an application reviewed by email (no published figure; a third party says "a few days"), then manual approval of each release | builds over time, like OV |
| **Certum Open Source Code Signing** | about 49 EUR a year (cloud, "SimplySign") or 69 EUR (card and reader) | individuals with a public open-source project; ID plus a utility bill | "Open Source Developer, Your Name" | identity check; days | builds over time |
| **Azure Artifact Signing** | 9.99 USD a month (Basic) | individuals **only in the USA and Canada**; organisations in more countries | your legal name, city, state, country | identity check through the Azure portal (ID, selfie); minutes to days | builds over time; not instant |
| **Ordinary OV certificate** | about 130 to 300 USD a year, plus a token or cloud HSM | individuals (as "IV") and companies | your legal name | identity check; days to weeks | builds over time |
| **EV certificate** | 400 USD a year and up | registered companies only | the company | weeks | same as OV since 2024 |

Details and sources:

- **Microsoft Store.** Registration is free for individuals
  ([announcement, 2025-09-10](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/);
  start at storedeveloper.microsoft.com). An MSIX package is re-signed and hosted by
  Microsoft, so no certificate is needed and there is no SmartScreen warning. Submitting the
  existing `.exe` instead does **not** avoid a certificate: an unpackaged installer must
  already be signed by a trusted CA
  ([requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements)).
  electron-builder 26 has an `appx` target
  ([docs](https://www.electron.build/v26/docs/appx)). Not tried here; open questions are in
  "What nobody has checked" below.
- **SignPath Foundation** ([signpath.org](https://signpath.org/),
  [terms](https://signpath.org/terms)). Conditions include: an OSI-approved licence with no
  proprietary parts; an actively maintained project that has already been released; a "Code
  signing policy" page on the project site naming who can approve releases, with the line
  "Free code signing provided by SignPath.io, certificate by SignPath Foundation";
  multi-factor authentication for every team member; binaries built from the public
  repository on GitHub-hosted runners and submitted from the workflow
  ([GitHub integration](https://docs.signpath.io/trusted-build-systems/github)). Every
  release is approved by hand. It signs `.exe` files, including installers, but its
  documentation does not mention NSIS or electron-builder: signing would happen after the
  build, outside electron-builder, so the build needs a step that signs the app's `.exe`
  files before the installer is made, or a custom electron-builder `sign` hook.
- **Certum** ([cloud](https://shop.certum.eu/open-source-code-signing-on-simplysign.html),
  [card set](https://shop.certum.eu/open-source-code-signing.html),
  [documents](https://support.certum.eu/en/code-signing-required-documents/)). One-year
  certificates. The cloud version needs Certum's SimplySign apps on a phone and on the build
  PC, and signs through the Windows certificate store (`WIN_SIGN_SHA1`). Whether it is
  issued in every country was not confirmed.
- **Azure Artifact Signing**
  ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart),
  [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)). "Individual
  developers must be located in the United States or Canada." Needs a paid Azure
  subscription (not free or trial) whose billing account is of type Individual, with a legal
  name and address that match a government ID. Certificates live 72 hours and are renewed
  daily, so the timestamp (added automatically) is what keeps a signature valid. Billing
  starts when the account is created.
- **OV and EV.** Since June 2023 the private key of any publicly trusted code-signing
  certificate must live in certified hardware (a token, an HSM or a cloud signing service),
  so a certificate can no longer be bought as a file, and since March 2026 a certificate is
  valid for at most 460 days
  ([CA/Browser Forum requirements](https://cabforum.org/working-groups/code-signing/requirements/)).
  EV is for registered organisations only and no longer buys instant trust.
- **winget** is a way to distribute, not to sign: the community repository does not ask for
  a signature, and the player's PC applies SmartScreen and Smart App Control just the same.

## Recommendation

1. **Ship the first betas unsigned**, say so plainly (the README does), and publish the
   installer's SHA-256 with each release. People with a simulator PC are used to "More
   info, Run anyway", and running from source is always there.
2. **If you live in the USA or Canada: Azure Artifact Signing.** About 10 USD a month, no
   hardware, identity check in minutes to days, and it is already wired: set the variables
   above. Your legal name appears as the publisher.
3. **Anywhere else: Certum's open-source certificate** (about 49 EUR a year, cloud). Your
   name appears as "Open Source Developer, ...". Set `WIN_SIGN_SHA1`.
4. **If you would rather not have your own name on it: SignPath Foundation.** Free, and the
   publisher shown is the foundation. It costs more work: the release must be built by a
   GitHub Actions workflow, the project needs a signing-policy page, and each release waits
   for approval. Apply once the repository is public and has a release.
5. **Later, for reach: the Microsoft Store.** Free, no warning at all, and the only route
   that fully satisfies Smart App Control without paying. It needs an MSIX build and a
   Store listing, which nobody has tried for this app yet.

Whichever certificate signs the installer, keep using the **same one**: reputation belongs
to the certificate, and a new one starts again from zero.

## What nobody has checked

- Any signing route, end to end, for this app.
- Whether the game works as a Store (MSIX) app: it listens on TCP 921 for another program
  on the same PC, which may be restricted for a packaged app, and it writes its data under
  `%APPDATA%`, which a package may redirect.
- Whether Smart App Control accepts Azure Artifact Signing signatures (Microsoft's pages
  describe the certificate authority's status in two different ways).
- SignPath Foundation's current lead time, and a working NSIS flow with it.
- Certum's availability by country.
