Scope file
==========

scope.json is a signed contract between you and the program owner.

Required fields
---------------
  program_name, program_url, authorized_by,
  authorization_document, authorization_sha256,
  not_before, expires_at, contact_email,
  allowed_hosts, allowed_schemes, allowed_ports,
  denied_paths, max_requests_per_host,
  max_requests_per_second, user_agent

Generating authorization_sha256
-------------------------------
1. Download the program's authorization PDF.
2. Place it next to scope.json.
3. Run:
     sha256sum authorization.pdf
4. Paste the hex value into authorization_sha256.

The module will refuse to start if the file's hash does not match.
