# @ayra/api-client

Typed authenticated REST calls for canonical Task state, versioned event replay, and short-lived result Artifact access. The host supplies an access token; this package does not create a session or store credentials. Mutations require an explicit idempotency key so retry identity survives UI reloads.

The desktop app is still a local preview. Its Clerk session and production Task execution are not connected yet.
