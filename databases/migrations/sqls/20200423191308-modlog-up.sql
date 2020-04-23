CREATE TABLE IF NOT EXISTS modlog (
    -- UNIX timestamp
    timestamp INTEGER NOT NULL,
    --- roomid OR global-roomid
    roomid TEXT NOT NULL,
    -- ROOMBAN, MUTE etc.
    action TEXT NOT NULL,
    -- Naming might be a bit poor here
    action_taker TEXT,
    userid TEXT,
    autoconfirmed_userid TEXT,
    -- foo,bar
    alts TEXT,
    ip TEXT,
    note TEXT
);

CREATE INDEX ml_index_1 ON modlog(timestamp);
CREATE INDEX ml_index_2 ON modlog(roomid, timestamp);
CREATE INDEX ml_index_3 ON modlog(action, timestamp);
CREATE INDEX ml_index_4 ON modlog(action_taker, timestamp);
CREATE INDEX ml_index_5 ON modlog(userid, timestamp);
CREATE INDEX ml_index_6 ON modlog(autoconfirmed_userid, timestamp);
CREATE INDEX ml_index_7 ON modlog(ip, timestamp);
