DELETE FROM Channels
  -- CHANNEL_TYPES.DM
  WHERE type = 1
    AND createdAt < NOW() - INTERVAL 1 HOUR
    AND NOT EXISTS (
      SELECT 1 FROM Messages m WHERE m.cid = Channels.id LIMIT 1
    );
