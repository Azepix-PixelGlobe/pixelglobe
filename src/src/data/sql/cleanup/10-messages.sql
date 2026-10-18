-- delete all messages except the most recent 1000 per channel

DELETE m FROM Messages m
  LEFT JOIN (
    SELECT id FROM (
      SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY cid ORDER BY id DESC
      ) as rn FROM Messages
    ) ranked WHERE rn <= 1000
) keep ON m.id = keep.id WHERE keep.id IS NULL;
