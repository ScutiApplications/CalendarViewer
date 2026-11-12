"""Private, offline Laya worker. Standard output carries only bounded JSON messages."""
import contextlib
import json
import os
import sys


def load_agent(folder):
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        import laya
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        return laya.load(folder, device="cpu")


def main():
    agent = load_agent(sys.argv[1])
    if "--check" in sys.argv:
        print(json.dumps({"ready": True}), flush=True)
        return
    print(json.dumps({"ready": True}), flush=True)
    while True:
        line = sys.stdin.buffer.readline(65537)
        if not line:
            return
        if len(line) > 65536:
            raise ValueError("Routing request too large")
        request = json.loads(line)
        try:
            tools = request["tools"]
            if not isinstance(tools, list) or not 1 <= len(tools) <= 32:
                raise ValueError("Invalid tools")
            questions = {tool["name"]: {
                "type": "choice",
                "instructions": "Is this calendar tool needed to answer the user's request? " + str(tool.get("description", ""))[:160],
                "criteria": {"A": "This tool is needed for the request.", "B": "This tool is not needed for the request."},
            } for tool in tools}
            with contextlib.redirect_stdout(sys.stderr):
                result = agent.predict(str(request["text"])[:4000], questions, max_len=1024)
            reply = {"id": request["id"], "answers": result["answers"], "usage": result.get("usage", {})}
        except Exception:
            reply = {"id": request.get("id"), "error": "Laya could not route this request."}
        print(json.dumps(reply, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
