#!/usr/bin/env python3
"""
Reset admin password for Mike Atlas staging via GoTrue Admin API.

Usage:
    python3 scripts/reset-admin-password.py [email] [new_password]

If arguments are omitted, defaults to mike-admin@atlasgov.com with a
generated password printed to stdout.

Requirements:
    - aws CLI configured with access to Secrets Manager
    - Network access to https://mike.agov.app

Key points:
    - GoTrue admin API path MUST include /supabase/ prefix (ALB routing)
    - Uses Python subprocess + urllib to avoid shell quoting issues with JWTs
    - Verifies login after reset
    - Never logs the password or service-role key
"""
import subprocess
import json
import sys
import time
import urllib.request
import urllib.error
import secrets
import string

SECRET_ID = "atlas-mike-staging-app-secrets"
REGION = "us-east-1"
BASE_URL = "https://mike.agov.app"
# GoTrue admin API path MUST include /supabase/ prefix — ALB routes only
# /supabase/* to the Kong target group. Without it, requests hit the
# Next.js frontend and return HTML 404.
ADMIN_USERS_URL = f"{BASE_URL}/supabase/auth/v1/admin/users"
TOKEN_URL = f"{BASE_URL}/supabase/auth/v1/token?grant_type=password"


def get_secrets():
    """Fetch secrets from AWS Secrets Manager via subprocess (avoids shell quoting)."""
    result = subprocess.run(
        ["aws", "secretsmanager", "get-secret-value",
         "--secret-id", SECRET_ID,
         "--region", REGION,
         "--query", "SecretString", "--output", "text"],
        capture_output=True, text=True, timeout=15
    )
    if result.returncode != 0:
        print(f"ERROR: Failed to get secrets: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def list_users(service_key):
    """List all GoTrue users via admin API."""
    req = urllib.request.Request(
        ADMIN_USERS_URL,
        headers={
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }
    )
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read()).get("users", [])


def find_user(users, email):
    """Find a user by email in the GoTrue users list."""
    user = next((u for u in users if u.get("email") == email), None)
    if not user:
        print(f"ERROR: User '{email}' not found. Users in GoTrue:", file=sys.stderr)
        for u in users:
            print(f"  - {u.get('email')} (id: {u.get('id')})", file=sys.stderr)
        sys.exit(1)
    return user


def update_password(service_key, user_id, new_password):
    """Update a user's password via GoTrue admin API."""
    req = urllib.request.Request(
        f"{ADMIN_USERS_URL}/{user_id}",
        data=json.dumps({"password": new_password}).encode(),
        headers={
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
            "Content-Type": "application/json",
        },
        method="PUT"
    )
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read())


def verify_login(anon_key, email, password):
    """Verify that login works with the new password."""
    req = urllib.request.Request(
        TOKEN_URL,
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={
            "apikey": anon_key,
            "Content-Type": "application/json",
        },
        method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=15)
    data = json.loads(resp.read())
    return len(data.get("access_token", "")) > 0


def main():
    email = sys.argv[1] if len(sys.argv) > 1 else "mike-admin@atlasgov.com"
    if len(sys.argv) > 2:
        new_password = sys.argv[2]
    else:
        new_password = "Atlas@Mike" + ''.join(
            secrets.choice(string.ascii_letters + string.digits) for _ in range(6)
        ) + "!"

    print(f"Fetching secrets from Secrets Manager...")
    secrets_data = get_secrets()
    service_key = secrets_data["SUPABASE_SECRET_KEY"]
    anon_key = secrets_data["SUPABASE_ANON_KEY"]

    print(f"Listing GoTrue users...")
    users = list_users(service_key)
    print(f"  Found {len(users)} users")

    user = find_user(users, email)
    user_id = user["id"]
    print(f"  Target user: {email} (id: {user_id})")

    print(f"Updating password...")
    update_password(service_key, user_id, new_password)
    print(f"  Password updated (HTTP 200)")

    print(f"Verifying login...")
    if verify_login(anon_key, email, new_password):
        print(f"  Login verified: HTTP 200, token acquired")
    else:
        print(f"  ERROR: Login verification failed", file=sys.stderr)
        sys.exit(1)

    print()
    print("=" * 50)
    print("PASSWORD RESET SUCCESSFUL")
    print("=" * 50)
    print(f"URL: {BASE_URL}")
    print(f"Email: {email}")
    print(f"Password: {new_password}")
    print("=" * 50)


if __name__ == "__main__":
    main()
