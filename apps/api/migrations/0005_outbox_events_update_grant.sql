-- 0005_outbox_events_update_grant: kd_app may update outbox_events.published_at only (A0-T13, the
-- Phase A0 gate review of 2026-11-06). 0002 granted UPDATE on every column, so a faulty statement as
-- kd_app could rewrite the audience, scope or payload of a pending event before the relay (A10)
-- publishes it. The relay only marks events as published; DELETE stays for the 7-day purge.

REVOKE UPDATE ON TABLE public.outbox_events FROM kd_app;
GRANT UPDATE (published_at) ON TABLE public.outbox_events TO kd_app;
