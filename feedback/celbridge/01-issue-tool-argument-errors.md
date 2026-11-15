<!-- GitHub issue (bug report). Status: draft, not posted. -->

# Agent tools: a wrong argument name or type fails with only "An error occurred invoking '<tool>'"

**Celbridge version:** 1.7.0

**Operating system:** Windows 11 Home (10.0.26200)

**Steps to reproduce**

1. Open any project and connect an MCP client to Celbridge's agent server (for example `cel.agent.claude()`).
2. Call `file_write` with `{"resource": "notes.md", "content": "x"}`. The parameter is called `fileResource`, but the read tools call it `resource`.
3. Call `file_read_many` with `{"resources": ["README.md"]}`, passing an array where the tool expects a JSON string.

**What happened?**

Both calls fail with only `An error occurred invoking 'file_write'.` (or `'file_read_many'`). The message gives no hint of which argument is wrong. The same happens for `file_read` called with `fileResource`, and `explorer_move` called with `resource`.

Expected: a message naming the problem, such as "Unknown parameter 'resource'. Expected: fileResource, content", or "'resources' must be a JSON array encoded as a string".

Why it matters: the parameter names differ by design between the read tools (`resource`) and the write and edit tools (`fileResource`), so agents and people get this wrong. Each opaque failure costs an agent a turn of guessing. Building a package against the tools, I hit both cases within an hour.

**Possible fix**

The generic text looks like the MCP C# SDK hiding the binding exception. The call-tool filter that already wraps every call (`AgentResponseFilter.InvokeAsync`) could check `context.Params.Arguments` against the tool's input schema before calling `next`. For unknown or missing parameter names, and for type mismatches, it could return `ToolResponse` errors that list the expected parameters and types. I haven't checked whether the SDK offers a hook for the binding error itself, which might be neater.

**Screenshots and logs:** a log can be attached on request.
