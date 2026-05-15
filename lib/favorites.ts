import type { SupabaseClient } from "@supabase/supabase-js";

export type FavoriteShow = {
  id: string;
  name: string;
  year: number | null;
  status: string;
  created_at: string;
};

export async function getFavoriteShows(
  supabase: SupabaseClient,
  userId: string,
): Promise<FavoriteShow[]> {
  const { data, error } = await supabase
    .from("trade_shows")
    .select("id, name, year, status, created_at")
    .eq("user_id", userId)
    .eq("is_favorite", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getFavoriteShows: ${error.message}`);
  return (data ?? []) as FavoriteShow[];
}

export async function toggleFavorite(
  supabase: SupabaseClient,
  showId: string,
  next: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("trade_shows")
    .update({ is_favorite: next })
    .eq("id", showId);
  if (error) throw new Error(`toggleFavorite: ${error.message}`);
}
