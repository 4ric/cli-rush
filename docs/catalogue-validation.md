# Catalogue validation

## Current status

As checked on 11 July 2026, **0 of 214 built-in learning objectives are verified on a named IOS or IOS XE image**. The application must continue to describe the pack as a simulator-tested draft.

The local, read-only discovery check found:

- no `qcow`, `qcow2`, `vmdk`, `vdi`, `refplat` ISO/ZIP or VIRL lab files below the current user profile;
- no CML-, VIRL-, IOS-, Catalyst 8000V- or IOL-named Hyper-V virtual machines;
- no Docker, VirtualBox or VMware command-line runtime available;
- no CML/VIRL environment variables or hosts-file entries; and
- no listener at `127.0.0.1` on ports 443, 8000 or 8080.

This is not proof that the project owner has no remote lab. It means that no authorised image or endpoint was discoverable from this workspace, so no command could honestly be promoted to `verified-on-image`. The exact blocker is access to an authorised Cisco CML reference platform plus genuine, sanitised command captures from it. Proprietary Cisco images must not be downloaded, copied into, or committed to this repository.

## Named targets

The target assignments live in `lib/platform-validation.ts`. Cisco's current CML reference-platform table identifies the following exact platforms and versions:

| Target ID | Cisco platform | Family | Version | Official source |
| --- | --- | --- | --- | --- |
| `cml-iosv-15.9-3-m9` | IOSv | Router | 15.9(3)M9 | [Cisco CML reference platforms and images](https://developer.cisco.com/docs/modeling-labs/reference-platforms-and-images/) |
| `cml-iosvl2-15.2` | IOSv L2 | Switch | 15.2 | [Cisco CML reference platforms and images](https://developer.cisco.com/docs/modeling-labs/reference-platforms-and-images/) |
| `cml-cat8000v-17.15.01a` | Catalyst 8000V | Router | 17.15.01a ED | [Cisco CML reference platforms and images](https://developer.cisco.com/docs/modeling-labs/reference-platforms-and-images/) |
| `cml-iol-l2-17.15.01` | IOL L2 | Switch | 17.15.01 | [Cisco CML reference platforms and images](https://developer.cisco.com/docs/modeling-labs/reference-platforms-and-images/) |

Cisco describes IOSvL2 as a virtual IOS Layer 2 switch with supported and unsupported feature boundaries. Those limits are a reason to validate switching commands on an assigned switching image rather than assuming feature parity from router documentation. See [Cisco's IOSvL2 platform documentation](https://developer.cisco.com/docs/modeling-labs/iosvl2/).

A link to official syntax documentation is a **documentation cross-check**, not evidence that a command ran successfully on a target image. One successful target capture is also evidence only for that named platform and version; it does not prove support across all IOS or IOS XE devices.

## Offline evidence workflow

The game never connects to a device and the evidence validator never executes a command. A networking reviewer performs lab work separately, exports evidence, and then uses this repository only to verify its metadata and integrity.

1. Use an authorised, isolated CML lab with the exact assigned platform and version.
2. Start a clean node and capture `show version` so that the platform identity and software version are visible in the evidence file.
3. For each catalogue command, capture the prompt before entry, the complete canonical command and the observed result. The prompt must demonstrate the expected starting CLI mode.
4. Treat a command as accepted only when its intended result is demonstrated: a prompt transition for navigation, relevant output for verification, or a separate verification command for a state change. Merely receiving no parser error is insufficient.
5. Record rejected syntax exactly, including the parser marker or platform error. Rejection evidence is useful compatibility data but does not verify the catalogue answer.
6. For a configuration command, also capture verification and safe cleanup or rollback. Reset the disposable node between tests when state could affect the result.
7. Remove credentials, cookies, tokens, licence identifiers and unrelated configuration from the capture. Do not test against a production device.
8. Store the sanitised transcript or screenshot below `validation/evidence/`, calculate its SHA-256 digest, and add one or more records to `validation/lab-evidence.json`.
9. Run `npm run validate:lab-evidence`. A pass means that the records match known command IDs and targets, use the correct mode and canonical accepted input, and reference untampered local evidence files.
10. Have a second networking reviewer inspect the actual evidence. Only after that review may code and tests explicitly promote the target-specific command record to `verified-on-image`.

On PowerShell, calculate a digest with:

```powershell
(Get-FileHash -Algorithm SHA256 validation/evidence/capture.txt).Hash.ToLowerInvariant()
```

## Manifest record

Each record requires the named target and observed version, command ID, starting prompt/mode, exact entered input, accepted or rejected result, useful result notes, and an integrity-protected evidence reference. This example is intentionally incomplete and must not be pasted into the live manifest without a real capture:

```json
{
  "recordId": "2026-07-11-iosv-nav-enable-01",
  "capturedAt": "2026-07-11T12:00:00.000Z",
  "operator": "reviewer-name",
  "targetId": "cml-iosv-15.9-3-m9",
  "targetLabel": "Cisco CML IOSv 15.9(3)M9",
  "targetSoftwareVersion": "15.9(3)M9",
  "platformIdentity": "identifying show version line containing 15.9(3)M9",
  "commandId": "nav.enable",
  "expectedMode": "user",
  "promptBefore": "R1>",
  "input": "enable",
  "outcome": "accepted",
  "resultNotes": "Observed result and verification go here.",
  "evidenceRef": "validation/evidence/real-capture.txt",
  "evidenceLocator": "lines 12-18",
  "evidenceSha256": "the lowercase 64-character SHA-256 of the real capture"
}
```

The validator cannot establish who created a file or whether a transcript is truthful. Its job is to prevent accidental target drift, mode mismatches, missing captures and unnoticed evidence modification. Human review remains the trust boundary.
