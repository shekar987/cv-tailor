"""Browser core for the Jobhuntz worker (Chunk 35).

- ``session``  — a persistent-profile Chromium session (sign in once, logins persist).
- ``observer`` — a read-only page observer: a numbered list of the form's fields,
  plus login-wall / captcha detection. It never types or submits anything.
"""
