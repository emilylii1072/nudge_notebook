"""Run notebook cells in a live Jupyter kernel, one notebook per process.

The app speaks to this over stdin and stdout, one JSON object per line.
Why a Python helper rather than talking to a kernel from Node: a kernel is
reached over Jupyter's own ZeroMQ protocol, and `jupyter_client` already
implements every part of it, including the handshake, the heartbeat and
the ordering rules for the messages a cell produces. Rewriting that in
TypeScript would be a great deal of code to get subtly wrong.

The kernel stays alive between cells, which is the whole point: a variable
you make in one cell is still there for the next one, exactly as in
Jupyter.

Requests, one JSON object per line on stdin:

    {"id": "1", "action": "execute", "code": "x = 1"}
    {"id": "2", "action": "interrupt"}
    {"id": "3", "action": "restart"}
    {"id": "4", "action": "shutdown"}

Replies, one JSON object per line on stdout. Every reply carries the id of
the request it answers:

    {"id": "1", "ok": true, "status": "ok", "execution_count": 1,
     "outputs": [ ... nbformat outputs ... ]}
    {"id": "1", "ok": false, "error": "what went wrong"}

Outputs are in the shape nbformat stores them, so they go into the file
as they are.
"""

import json
import sys
import queue

try:
    from jupyter_client import KernelManager
except ImportError:  # pragma: no cover - reported to the app, not raised
    sys.stdout.write(
        json.dumps(
            {
                "id": "startup",
                "ok": False,
                "error": "jupyter_client is not installed in this Python. "
                "Install it with: pip install jupyter_client ipykernel",
            }
        )
        + "\n"
    )
    sys.stdout.flush()
    sys.exit(1)


def reply(payload):
    """Send one reply and make sure the app sees it now."""
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def output_from(msg):
    """One iopub message as an nbformat output, or None when it is not one."""
    kind = msg["header"]["msg_type"]
    content = msg["content"]
    if kind == "stream":
        return {"output_type": "stream", "name": content.get("name", "stdout"),
                "text": content.get("text", "")}
    if kind == "execute_result":
        return {"output_type": "execute_result",
                "data": content.get("data", {}),
                "metadata": content.get("metadata", {}),
                "execution_count": content.get("execution_count")}
    if kind == "display_data":
        return {"output_type": "display_data",
                "data": content.get("data", {}),
                "metadata": content.get("metadata", {})}
    if kind == "error":
        return {"output_type": "error",
                "ename": content.get("ename", ""),
                "evalue": content.get("evalue", ""),
                "traceback": content.get("traceback", [])}
    return None


class Runner:
    def __init__(self):
        self.manager = KernelManager()
        self.manager.start_kernel()
        self.client = self.manager.client()
        self.client.start_channels()
        self.client.wait_for_ready(timeout=120)

    def execute(self, code, timeout):
        """Run one cell and collect everything it produced.

        A cell is finished when the kernel reports itself idle again for
        this request. That is the signal to wait on: the outputs and the
        reply arrive on two channels and in no fixed order, so counting
        them or waiting for the reply alone would cut a cell short.
        """
        msg_id = self.client.execute(code, store_history=True)
        outputs = []
        execution_count = None
        status = "ok"

        while True:
            try:
                msg = self.client.get_iopub_msg(timeout=timeout)
            except queue.Empty:
                return {
                    "ok": False,
                    "error": f"the cell was still running after {timeout} seconds",
                }
            if msg.get("parent_header", {}).get("msg_id") != msg_id:
                continue
            kind = msg["header"]["msg_type"]
            if kind == "status":
                if msg["content"].get("execution_state") == "idle":
                    break
                continue
            if kind == "execute_input":
                execution_count = msg["content"].get("execution_count")
                continue
            if kind == "error":
                status = "error"
            found = output_from(msg)
            if found is not None:
                outputs.append(found)

        # The reply carries nothing this app needs, but taking it off the
        # channel keeps it clean for the next cell.
        try:
            self.client.get_shell_msg(timeout=5)
        except queue.Empty:
            pass

        return {
            "ok": True,
            "status": status,
            "execution_count": execution_count,
            "outputs": merge_streams(outputs),
        }

    def interrupt(self):
        self.manager.interrupt_kernel()
        return {"ok": True}

    def restart(self):
        self.manager.restart_kernel(now=True)
        self.client.wait_for_ready(timeout=120)
        return {"ok": True}

    def shutdown(self):
        try:
            self.client.stop_channels()
            self.manager.shutdown_kernel(now=True)
        finally:
            return {"ok": True}


def merge_streams(outputs):
    """Join runs of stream output, the way a notebook stores them.

    A `print` in a loop arrives as many small messages, and storing each
    one as its own output makes a file that is large and hard to read.
    """
    merged = []
    for out in outputs:
        last = merged[-1] if merged else None
        if (
            last is not None
            and last["output_type"] == "stream"
            and out["output_type"] == "stream"
            and last["name"] == out["name"]
        ):
            last["text"] = last["text"] + out["text"]
            continue
        merged.append(dict(out))
    # nbformat writes a stream's text as a list of lines.
    for out in merged:
        if out["output_type"] == "stream" and isinstance(out["text"], str):
            out["text"] = out["text"].splitlines(keepends=True)
    return merged


def main():
    try:
        runner = Runner()
    except Exception as err:  # pragma: no cover - reported to the app
        reply({"id": "startup", "ok": False, "error": f"the kernel would not start: {err}"})
        return 1
    reply({"id": "startup", "ok": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        rid = request.get("id", "")
        action = request.get("action", "execute")
        try:
            if action == "execute":
                result = runner.execute(request.get("code", ""), request.get("timeout", 120))
            elif action == "interrupt":
                result = runner.interrupt()
            elif action == "restart":
                result = runner.restart()
            elif action == "shutdown":
                reply({"id": rid, **runner.shutdown()})
                return 0
            else:
                result = {"ok": False, "error": f"unknown action: {action}"}
        except Exception as err:
            result = {"ok": False, "error": str(err)}
        reply({"id": rid, **result})
    runner.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
