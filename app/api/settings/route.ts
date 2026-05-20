import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getSettings,
  updatePrioContext,
  updateModels,
  updatePrompts,
  updateParams,
  updateHandbook,
  defaultPrioContext,
  defaultShortSystemPrompt,
  defaultShortUserTemplate,
  defaultDeepSystemPrompt,
  defaultDeepUserTemplate,
  defaultChatSystemPrompt,
  defaultHandbook,
  PARAM_DEFAULTS,
  PARAM_BOUNDS,
} from "@/lib/settings";
import { SHOW_DISCOVERY_SYSTEM_DEFAULT, COMPETITOR_DISCOVERY_SYSTEM_DEFAULT } from "@/lib/claude";
import { COMPANY_SEARCH_SYSTEM_DEFAULT } from "@/lib/claude-company-search";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const settings = await getSettings(supabase, user.id);
  return NextResponse.json(settings);
}

const PromptResetField = z.enum([
  "prio_context",
  "short_system_prompt",
  "short_user_template",
  "deep_system_prompt",
  "deep_user_template",
  "chat_system_prompt",
  "show_discovery_system_prompt",
  "competitor_discovery_system_prompt",
  "company_search_system_prompt",
  "handbook",
  "short_max_tokens",
  "short_max_input_chars",
  "deep_max_tokens",
  "deep_max_input_chars",
  "chat_max_tokens",
  "chat_web_search_max_uses",
]);

const PutBody = z.object({
  prio_context: z.string().min(10).max(20_000).optional(),
  short_model: z.string().min(3).max(100).optional(),
  deep_model: z.string().min(3).max(100).optional(),
  competitor_discovery_model: z.string().min(3).max(100).nullable().optional(),
  company_search_model: z.string().min(3).max(100).nullable().optional(),
  short_system_prompt: z.string().max(20_000).nullable().optional(),
  short_user_template: z.string().max(20_000).nullable().optional(),
  deep_system_prompt: z.string().max(20_000).nullable().optional(),
  deep_user_template: z.string().max(20_000).nullable().optional(),
  chat_system_prompt: z.string().max(20_000).nullable().optional(),
  show_discovery_system_prompt: z.string().max(20_000).nullable().optional(),
  competitor_discovery_system_prompt: z.string().max(20_000).nullable().optional(),
  company_search_system_prompt: z.string().max(20_000).nullable().optional(),
  handbook: z.string().max(30_000).nullable().optional(),
  short_max_tokens: z.number().int().min(100).max(8000).nullable().optional(),
  short_max_input_chars: z.number().int().min(500).max(200_000).nullable().optional(),
  deep_max_tokens: z.number().int().min(200).max(16000).nullable().optional(),
  deep_max_input_chars: z.number().int().min(1000).max(500_000).nullable().optional(),
  chat_max_tokens: z.number().int().min(200).max(16000).nullable().optional(),
  chat_web_search_max_uses: z.number().int().min(0).max(20).nullable().optional(),
  /** Backwards-compat: legacy `reset: true` setzt Prio-Kontext zurueck. */
  reset: z.literal(true).optional(),
  /** Zielgenauer Reset: setzt das genannte Feld auf den Code-Default zurueck. */
  reset_field: PromptResetField.optional(),
});

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // ensure row exists
  await getSettings(supabase, user.id);

  let body: z.infer<typeof PutBody>;
  try {
    body = PutBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (body.reset) {
    await updatePrioContext(supabase, user.id, defaultPrioContext());
  } else if (body.reset_field === "prio_context") {
    await updatePrioContext(supabase, user.id, defaultPrioContext());
  } else if (body.prio_context !== undefined) {
    await updatePrioContext(supabase, user.id, body.prio_context);
  }

  if (body.reset_field === "handbook") {
    await updateHandbook(supabase, user.id, defaultHandbook());
  } else if (body.handbook !== undefined) {
    await updateHandbook(supabase, user.id, body.handbook);
  }

  if (body.short_model || body.deep_model || body.competitor_discovery_model !== undefined || body.company_search_model !== undefined) {
    const patch: Record<string, unknown> = {};
    if (body.short_model) patch.short_model = body.short_model;
    if (body.deep_model) patch.deep_model = body.deep_model;
    if (body.competitor_discovery_model !== undefined) patch.competitor_discovery_model = body.competitor_discovery_model;
    if (body.company_search_model !== undefined) patch.company_search_model = body.company_search_model;
    const { error } = await supabase.from("app_settings").update(patch).eq("user_id", user.id);
    if (error) throw new Error(`update models: ${error.message}`);
  }

  // Direkter Reset auf den Code-Default. Bei Texten schreiben wir den
  // Default-Text explizit rein, damit der User ihn im Editor sieht und
  // weiterbearbeiten kann (NULL in der DB ist semantisch "Default verwenden",
  // wuerde im Editor aber als leer erscheinen). Bei Zahlen setzen wir auf NULL,
  // damit die Code-Konstante als Source-of-Truth bleibt - im UI lesen wir
  // PARAM_DEFAULTS als Initialwert.
  const PROMPT_DEFAULT_GETTERS: Record<string, () => string> = {
    short_system_prompt: defaultShortSystemPrompt,
    short_user_template: defaultShortUserTemplate,
    deep_system_prompt: defaultDeepSystemPrompt,
    deep_user_template: defaultDeepUserTemplate,
    chat_system_prompt: defaultChatSystemPrompt,
    show_discovery_system_prompt: () => SHOW_DISCOVERY_SYSTEM_DEFAULT,
    competitor_discovery_system_prompt: () => COMPETITOR_DISCOVERY_SYSTEM_DEFAULT,
    company_search_system_prompt: () => COMPANY_SEARCH_SYSTEM_DEFAULT,
  };
  const PARAM_FIELDS = new Set(Object.keys(PARAM_DEFAULTS));

  if (body.reset_field && body.reset_field !== "prio_context") {
    const f = body.reset_field;
    if (f in PROMPT_DEFAULT_GETTERS) {
      await updatePrompts(supabase, user.id, {
        [f]: PROMPT_DEFAULT_GETTERS[f](),
      });
    } else if (PARAM_FIELDS.has(f)) {
      await updateParams(supabase, user.id, { [f]: null });
    }
  }

  const promptPatch: Record<string, string | null> = {};
  if (body.short_system_prompt !== undefined)
    promptPatch.short_system_prompt = body.short_system_prompt;
  if (body.short_user_template !== undefined)
    promptPatch.short_user_template = body.short_user_template;
  if (body.deep_system_prompt !== undefined)
    promptPatch.deep_system_prompt = body.deep_system_prompt;
  if (body.deep_user_template !== undefined)
    promptPatch.deep_user_template = body.deep_user_template;
  if (body.chat_system_prompt !== undefined)
    promptPatch.chat_system_prompt = body.chat_system_prompt;
  if (body.show_discovery_system_prompt !== undefined)
    promptPatch.show_discovery_system_prompt = body.show_discovery_system_prompt;
  if (body.competitor_discovery_system_prompt !== undefined)
    promptPatch.competitor_discovery_system_prompt = body.competitor_discovery_system_prompt;
  if (body.company_search_system_prompt !== undefined)
    promptPatch.company_search_system_prompt = body.company_search_system_prompt;
  if (Object.keys(promptPatch).length > 0) {
    await updatePrompts(supabase, user.id, promptPatch);
  }

  const paramPatch: Record<string, number | null> = {};
  for (const k of [
    "short_max_tokens",
    "short_max_input_chars",
    "deep_max_tokens",
    "deep_max_input_chars",
    "chat_max_tokens",
    "chat_web_search_max_uses",
  ] as const) {
    const v = body[k];
    if (v !== undefined) {
      // Sanity-Bounds noch mal in der API erzwingen (Zod hat schon, aber
      // PARAM_BOUNDS ist die Single Source of Truth fuer Bounds).
      if (v === null) {
        paramPatch[k] = null;
      } else {
        const b = PARAM_BOUNDS[k];
        paramPatch[k] = Math.max(b.min, Math.min(b.max, Math.trunc(v)));
      }
    }
  }
  if (Object.keys(paramPatch).length > 0) {
    await updateParams(supabase, user.id, paramPatch);
  }

  const fresh = await getSettings(supabase, user.id);
  return NextResponse.json(fresh);
}
