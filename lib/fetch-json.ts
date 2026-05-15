export async function parseErrorJson(res: Response): Promise<{ error?: string; [key: string]: unknown }> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}
