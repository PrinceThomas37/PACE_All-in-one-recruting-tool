-- 061: a PUBLIC storage bucket for the optional logo in a mailbox's email signature (owner, 8 Oct 2026, D-0104).
--
-- A recipient's mail client must be able to fetch the picture, so this bucket is public — and it holds NOTHING else (the résumé /
-- document bucket 'candidate-docs' stays private). PACE writes to it with its service key only (routes/auth.js
-- POST /users/:id/emails/:eid/signature-logo): a PNG, JPEG, GIF or WEBP of at most 200 KB, one file per mailbox.
--
-- Until this is applied the logo choice answers "Logo upload is not switched on yet" and everything else works as before.
-- Apply BEFORE the code that uses it is relied on; never to the live database without the owner's fresh go-ahead.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signature-logos', 'signature-logos', true, 204800, ARRAY['image/png','image/jpeg','image/gif','image/webp'])
ON CONFLICT (id) DO NOTHING;
