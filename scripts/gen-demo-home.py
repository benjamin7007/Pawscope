#!/usr/bin/env python3
"""Generate a synthetic demo HOME for Pawscope screenshot capture.

Produces ~/.copilot/session-state with 6 fake sessions whose names, repos,
prompts, and tool calls are all fictional. No real personal data.
"""
import json
import os
import random
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

random.seed(42)

DEMO_HOME = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/pawscope-demo-home")

SESSIONS = [
    dict(
        id="11111111-1111-4111-8111-111111111111",
        repo="my-org/todo-app",
        branch="master",
        summary="Build TODO app with React + Tailwind",
        prompts=[
            "Scaffold a React TODO app with Tailwind v4",
            "Add localStorage persistence",
            "Write Vitest unit tests for the store",
            "How do I configure Tailwind dark mode?",
        ],
        active=True,
        age_min=120,
        model="claude-opus-4.7",
    ),
    dict(
        id="22222222-2222-4222-8222-222222222222",
        repo="my-org/payments",
        branch="main",
        summary="Add Stripe webhook handler",
        prompts=[
            "Add a /webhook/stripe Express endpoint",
            "Verify the Stripe signature header properly",
            "Write integration tests with stripe-mock",
        ],
        active=True,
        age_min=240,
        model="claude-sonnet-4.6",
    ),
    dict(
        id="33333333-3333-4333-8333-333333333333",
        repo="my-org/api-server",
        branch="main",
        summary="Generate OpenAPI documentation",
        prompts=[
            "Generate OpenAPI 3.1 spec from our routes",
            "Add Swagger UI at /docs",
            "Document the auth header on each endpoint",
        ],
        active=False,
        age_min=60 * 24,
        model="claude-sonnet-4.6",
    ),
    dict(
        id="44444444-4444-4444-8444-444444444444",
        repo="my-org/db-ops",
        branch="main",
        summary="Migrate Postgres 14 to 15",
        prompts=[
            "Plan the Postgres 14 to 15 upgrade",
            "Test the migration on the staging replica",
            "Write a rollback procedure",
        ],
        active=False,
        age_min=60 * 48,
        model="claude-opus-4.7",
    ),
    dict(
        id="55555555-5555-4555-8555-555555555555",
        repo="my-org/web",
        branch="main",
        summary="Fix flaky end-to-end checkout test",
        prompts=[
            "Find why checkout.spec.ts is flaky",
            "Replace networkidle with explicit waits",
            "Re-run the suite 20 times and report failure rate",
        ],
        active=False,
        age_min=60 * 6,
        model="claude-sonnet-4.6",
    ),
    dict(
        id="66666666-6666-4666-8666-666666666666",
        repo="my-org/cli",
        branch="develop",
        summary="Refactor authentication module",
        prompts=[
            "Refactor src/auth into smaller modules",
            "Move JWT logic into auth/jwt.ts",
            "Add rate limiting on /login",
        ],
        active=False,
        age_min=60 * 12,
        model="claude-opus-4.7",
    ),
]

TOOLS = ["bash", "view", "edit", "create", "grep", "glob"]
SKILLS = ["brainstorming", "writing-plans", "test-driven-development",
          "verification-before-completion", "writing-skills"]


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond//1000:03d}Z"


def write_session(s):
    base = DEMO_HOME / ".copilot" / "session-state" / s["id"]
    base.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    started = now - timedelta(minutes=s["age_min"])
    updated = started + timedelta(minutes=min(s["age_min"], 90))

    workspace = (
        f"id: {s['id']}\n"
        f"cwd: /Users/demo/{s['repo'].split('/')[1]}\n"
        f"git_root: /Users/demo/{s['repo'].split('/')[1]}\n"
        f"repository: {s['repo']}\n"
        f"host_type: github\n"
        f"branch: {s['branch']}\n"
        f"summary: {s['summary']}\n"
        f"summary_count: {len(s['prompts'])}\n"
        f"created_at: {iso(started)}\n"
        f"updated_at: {iso(updated)}\n"
    )
    (base / "workspace.yaml").write_text(workspace)

    if s["active"]:
        (base / f"inuse.{random.randint(10000, 99999)}.lock").write_text("")

    events = []
    t = started

    def emit(typ, data):
        nonlocal t
        events.append({"type": typ, "data": data, "timestamp": iso(t)})
        t += timedelta(seconds=random.randint(1, 4))

    emit("session.start", {"sessionId": s["id"]})
    emit("session.model_change", {"newModel": s["model"]})

    for i, prompt in enumerate(s["prompts"]):
        emit("user.message", {"content": prompt, "interactionId": f"p{i}"})
        emit("assistant.turn_start", {})
        for _ in range(random.randint(2, 5)):
            tool = random.choice(TOOLS)
            emit("tool.execution_start", {"toolName": tool, "input": {}})
            emit("tool.execution_complete",
                 {"toolName": tool, "exit": 0, "output_preview": ""})
        if random.random() < 0.4:
            emit("skill.invoked", {"name": random.choice(SKILLS)})
        emit("assistant.message",
             {"content": "Working on it. Here's the plan...",
              "usage": {"input_tokens": random.randint(2000, 12000),
                        "output_tokens": random.randint(200, 2000),
                        "cache_read_input_tokens": random.randint(0, 5000)}})
        emit("assistant.turn_end", {})

    with (base / "events.jsonl").open("w") as fh:
        for e in events:
            fh.write(json.dumps(e) + "\n")


def main():
    if DEMO_HOME.exists():
        shutil.rmtree(DEMO_HOME)
    DEMO_HOME.mkdir(parents=True)
    (DEMO_HOME / ".claude").mkdir()
    (DEMO_HOME / ".codex").mkdir()
    (DEMO_HOME / ".claude" / "projects").mkdir()
    for s in SESSIONS:
        write_session(s)
    print(f"Demo HOME ready at: {DEMO_HOME}")
    print(f"Sessions: {len(SESSIONS)} ({sum(1 for s in SESSIONS if s['active'])} active)")


if __name__ == "__main__":
    main()
