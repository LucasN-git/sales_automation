-- Fix: competitive_angles_vs_isp war text[] aber wird im Code als text (plain string) behandelt.
-- Bestehende Arrays (falls vorhanden) werden per array_to_string zusammengefuehrt.
ALTER TABLE competitor_versions
  ALTER COLUMN competitive_angles_vs_isp TYPE text
    USING CASE
      WHEN competitive_angles_vs_isp IS NULL THEN NULL
      ELSE array_to_string(competitive_angles_vs_isp, ' ')
    END;
