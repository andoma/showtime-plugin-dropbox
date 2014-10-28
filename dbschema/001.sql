CREATE TABLE item (
       id INTEGER PRIMARY KEY,
       parent INTEGER REFERENCES item(id) ON DELETE CASCADE,
       name TEXT NOT NULL,
       rev TEXT,
       thumb_exists BOOLEAN,
       bytes INTEGER,
       mtime INTEGER,
       is_dir BOOLEAN,
       icon TEXT,
       mime_type TEXT,
       root TEXT,
       UNIQUE (name, parent)
);

CREATE INDEX item_name_idx ON item(name);
CREATE INDEX item_parent_idx ON item(parent);

INSERT INTO item (id, parent, name) VALUES (1,1,"");

CREATE TABLE cursor (
       cursor TEXT,
       lastdelta INTEGER
);

CREATE TABLE path_to_url (
       path TEXT,
       expire INTEGER,
       url TEXT,
       UNIQUE(path)
);

CREATE INDEX path_to_url_path_idx ON path_to_url(path);

