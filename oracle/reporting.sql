-- FieldSync: Oracle reporting layer (optional stretch goal)
-- Run in Oracle Live SQL (livesql.oracle.com) or Oracle Database Free.
-- Idea: SQL Server is the operational database; a nightly job copies findings to Oracle for reporting.

CREATE TABLE fs_findings (
  id                     VARCHAR2(36)  PRIMARY KEY,
  expedition_id          NUMBER(10)    NOT NULL,
  latitude               NUMBER(9,6)   NOT NULL,
  longitude              NUMBER(9,6)   NOT NULL,
  material_type          VARCHAR2(40)  NOT NULL,
  hydrocarbon_indicator  VARCHAR2(10)  NOT NULL,
  depth_m                NUMBER(8,2)   NOT NULL,
  captured_at            TIMESTAMP WITH TIME ZONE NOT NULL,
  engineer_name          VARCHAR2(100)
);

CREATE INDEX ix_fs_findings_exp ON fs_findings (expedition_id, material_type);

-- Sample rows (synthetic)
INSERT INTO fs_findings VALUES ('a1', 1, 22.512300, 72.501100, 'Shale',     'GasShow', 42.5, SYSTIMESTAMP, 'Field Engineer 1');
INSERT INTO fs_findings VALUES ('a2', 1, 22.520100, 72.498700, 'Sandstone', 'OilShow', 61.0, SYSTIMESTAMP, 'Field Engineer 1');
INSERT INTO fs_findings VALUES ('a3', 1, 22.531000, 72.510500, 'Shale',     'None',    18.2, SYSTIMESTAMP, 'Field Engineer 2');
INSERT INTO fs_findings VALUES ('a4', 1, 22.540400, 72.522200, 'Limestone', 'GasShow', 75.3, SYSTIMESTAMP, 'Field Engineer 2');
COMMIT;

-- Summary by material: how many samples, how many hydrocarbon shows, average depth
CREATE OR REPLACE PROCEDURE get_material_summary (
  p_expedition_id IN  NUMBER,
  p_result        OUT SYS_REFCURSOR
) AS
BEGIN
  IF p_expedition_id IS NULL OR p_expedition_id <= 0 THEN
    RAISE_APPLICATION_ERROR(-20001, 'A valid expedition id is required');
  END IF;

  OPEN p_result FOR
    SELECT material_type,
           COUNT(*)                                                        AS samples,
           SUM(CASE WHEN hydrocarbon_indicator <> 'None' THEN 1 ELSE 0 END) AS hydrocarbon_shows,
           ROUND(AVG(depth_m), 1)                                          AS avg_depth_m,
           ROUND(100 * SUM(CASE WHEN hydrocarbon_indicator <> 'None' THEN 1 ELSE 0 END) / COUNT(*), 1) AS show_rate_pct
      FROM fs_findings
     WHERE expedition_id = p_expedition_id
     GROUP BY material_type
     ORDER BY hydrocarbon_shows DESC, samples DESC;
END get_material_summary;
/

-- Try it:
VARIABLE rc REFCURSOR;
EXEC get_material_summary(1, :rc);
PRINT rc;
