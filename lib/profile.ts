import type { SupabaseClient, User } from "@supabase/supabase-js";

export type UserProfile = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  updated_at: string;
  email: string;
};

function defaultDisplayName(email: string | null | undefined): string {
  if (!email) return "User";
  const local = email.split("@")[0];
  return local && local.length > 0 ? local : "User";
}

export async function getProfile(
  supabase: SupabaseClient,
  user: User,
): Promise<UserProfile> {
  const { data } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, avatar_url, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (data) {
    const display = (data.display_name as string | null)?.trim();
    return {
      user_id: data.user_id as string,
      display_name: display && display.length > 0 ? display : defaultDisplayName(user.email),
      avatar_url: (data.avatar_url as string | null) ?? null,
      updated_at: data.updated_at as string,
      email: user.email ?? "",
    };
  }

  const seed = {
    user_id: user.id,
    display_name: defaultDisplayName(user.email),
    avatar_url: null,
  };
  const { data: created, error } = await supabase
    .from("user_profiles")
    .insert(seed)
    .select("user_id, display_name, avatar_url, updated_at")
    .single();
  if (error) throw new Error(`init profile failed: ${error.message}`);
  return {
    user_id: created.user_id as string,
    display_name: created.display_name as string,
    avatar_url: (created.avatar_url as string | null) ?? null,
    updated_at: created.updated_at as string,
    email: user.email ?? "",
  };
}

export async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<Pick<UserProfile, "display_name" | "avatar_url">>,
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.display_name !== undefined) {
    const trimmed = patch.display_name.trim();
    update.display_name = trimmed.length > 0 ? trimmed : null;
  }
  if (patch.avatar_url !== undefined) update.avatar_url = patch.avatar_url;
  if (Object.keys(update).length === 0) return;

  const { error } = await supabase
    .from("user_profiles")
    .update(update)
    .eq("user_id", userId);
  if (error) throw new Error(`updateProfile: ${error.message}`);
}
