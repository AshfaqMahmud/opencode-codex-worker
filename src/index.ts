import { Plugin } from "@opencode/plugin";
import { resolveConfig } from "./config.js";
import { JobManager } from "./jobs.js";
import { runTask } from "./runner.js";
import { createTools, type PermissionRequest, type ToolCallContext } from "./tools.js";

export default Plugin.define({
  id: "opencode-codex-worker",
  async setup(ctx) {
    const config = resolveConfig(ctx.options);
    const jobs = new JobManager(config, (input, hooks) => runTask(config, input, hooks));

    const permission = {
      assert: (request: PermissionRequest) =>
        ctx.permission.assert({
          sessionID: request.sessionID as never,
          ...(request.agent ? { agent: request.agent as never } : {}),
          action: request.action,
          resources: request.resources,
          ...(request.save ? { save: request.save } : {}),
          ...(request.source ? { source: request.source } : {}),
          ...(request.metadata ? { metadata: request.metadata } : {}),
        }),
    };

    const tools = createTools({
      config,
      jobs,
      directory: ctx.location.directory,
      permission,
    });

    const registration = await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "codex",
        description:
          "Delegate coding work to the Codex CLI, which runs as a separate agent with its own tools and can edit files.",
      });

      for (const tool of tools) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input,
          options: { namespace: "codex" },
          execute: (input: unknown, context) => tool.execute(input, context as ToolCallContext),
        });
      }
    });

    return async () => {
      jobs.dispose();
      await registration.dispose();
    };
  },
});
