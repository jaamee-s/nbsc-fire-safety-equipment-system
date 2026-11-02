-- ============================================================
-- Migration: Notifications + phone push notifications
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- What it does:
--   1. push_tokens    : each phone's Expo push token, per signed-in user
--   2. notifications  : one row per message per recipient (history + realtime)
--   3. triggers on maintenance_actions create the messages automatically:
--        - new defect reported            -> admins
--        - job order assigned/reassigned  -> the technician (old one too)
--        - technician started / repaired  -> admins
--        - job closed                     -> technician + inspectors
--        - job marked unresolved          -> technician
--   4. every new notifications row is pushed to the recipient's phones
--      through the Expo push service, so it shows on the phone even when
--      the app is closed.
--
-- Nobody is notified about their own action (e.g. a technician is not
-- notified that they themselves marked a job repaired).
-- ============================================================

-- pg_net lets the database make the HTTPS call to Expo's push service.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- 1. Push tokens -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own push tokens" ON push_tokens;
CREATE POLICY "Users read own push tokens"
  ON push_tokens FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Registration goes through a function so a phone that changes hands
-- (one person logs out, another logs in) moves its token to the new user.
CREATE OR REPLACE FUNCTION public.register_push_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  INSERT INTO push_tokens (token, user_id, platform, updated_at)
  VALUES (p_token, auth.uid(), p_platform, now())
  ON CONFLICT (token) DO UPDATE
    SET user_id = auth.uid(), platform = EXCLUDED.platform, updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM push_tokens WHERE token = p_token AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(text) TO authenticated;


-- 2. Notifications -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  kind text,
  action_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON notifications (recipient_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON notifications;
CREATE POLICY "Users read own notifications"
  ON notifications FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "Users mark own notifications read" ON notifications;
CREATE POLICY "Users mark own notifications read"
  ON notifications FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- Let the apps receive new rows instantly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;


-- 3. Helpers that create notification rows ---------------------------------
CREATE OR REPLACE FUNCTION public.notify_user(
  p_user uuid, p_title text, p_body text, p_kind text, p_action uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user IS NULL OR p_user = auth.uid() THEN
    RETURN;
  END IF;
  INSERT INTO notifications (recipient_id, title, body, kind, action_id)
  VALUES (p_user, p_title, p_body, p_kind, p_action);
END $$;

-- p_roles: e.g. ARRAY['inspector']. NULL means "admins" = every web
-- dashboard account (any role that is not inspector or technician),
-- which is exactly who the web app lets into the GSO dashboard.
CREATE OR REPLACE FUNCTION public.notify_roles(
  p_roles text[], p_title text, p_body text, p_kind text, p_action uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (recipient_id, title, body, kind, action_id)
  SELECT p.id, p_title, p_body, p_kind, p_action
  FROM profiles p
  WHERE p.id IS DISTINCT FROM auth.uid()
    AND (
      (p_roles IS NULL AND p.role NOT IN ('inspector', 'technician'))
      OR (p_roles IS NOT NULL AND p.role = ANY (p_roles))
    );
END $$;


-- 4. Events on maintenance_actions ------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_on_maintenance_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_type text;
  v_where text;
  v_tech uuid;
  v_old_tech uuid;
BEGIN
  SELECT e.equipment_code,
         e.equipment_type,
         concat_ws(' — ', b.building_name, e.exact_location)
    INTO v_code, v_type, v_where
  FROM equipment e
  LEFT JOIN buildings b ON b.id = e.building_id
  WHERE e.id = NEW.equipment_id;
  v_code := coalesce(v_code, 'Equipment');

  IF NEW.assigned_technician_id IS NOT NULL THEN
    SELECT profile_id INTO v_tech FROM technicians WHERE id = NEW.assigned_technician_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM notify_roles(
      NULL,
      'New defect reported: ' || v_code,
      initcap(coalesce(NEW.priority, 'medium')) || ' priority · ' || coalesce(NEW.description, '') ||
        CASE WHEN v_where <> '' THEN ' · ' || v_where ELSE '' END ||
        '. File a Job Order Request.',
      'new_defect', NEW.id
    );
    RETURN NEW;
  END IF;

  -- Job order assigned or reassigned
  IF NEW.assigned_technician_id IS DISTINCT FROM OLD.assigned_technician_id THEN
    PERFORM notify_user(
      v_tech,
      'New job order: ' || v_code,
      coalesce(NEW.description, 'Repair needed') ||
        CASE WHEN v_where <> '' THEN ' · ' || v_where ELSE '' END ||
        CASE WHEN coalesce(NEW.job_order_remarks, '') <> '' THEN '. GSO says: "' || NEW.job_order_remarks || '"' ELSE '' END,
      'job_assigned', NEW.id
    );
    IF OLD.assigned_technician_id IS NOT NULL THEN
      SELECT profile_id INTO v_old_tech FROM technicians WHERE id = OLD.assigned_technician_id;
      IF v_old_tech IS DISTINCT FROM v_tech THEN
        PERFORM notify_user(
          v_old_tech,
          'Job reassigned: ' || v_code,
          'GSO assigned this job to another technician. No further action needed from you.',
          'job_reassigned', NEW.id
        );
      END IF;
    END IF;
  END IF;

  -- Technician progress
  IF NEW.repair_status IS DISTINCT FROM OLD.repair_status THEN
    IF NEW.repair_status = 'working' THEN
      PERFORM notify_roles(
        NULL,
        'Technician started working on ' || v_code,
        coalesce(v_where, ''),
        'repair_working', NEW.id
      );
    ELSIF NEW.repair_status = 'repaired' THEN
      PERFORM notify_roles(
        NULL,
        'Repair finished: ' || v_code,
        CASE WHEN coalesce(NEW.repair_note, '') <> ''
             THEN 'Technician note: "' || NEW.repair_note || '"'
             ELSE coalesce(v_where, '') END,
        'repair_done', NEW.id
      );
    END IF;
  END IF;

  -- Job closed / unresolved
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'completed' THEN
      PERFORM notify_user(
        v_tech,
        'Job closed: ' || v_code,
        'The job is recorded as completed. Thank you for the repair.',
        'job_closed', NEW.id
      );
      PERFORM notify_roles(
        ARRAY['inspector'],
        CASE WHEN v_type = 'fire_extinguisher'
             THEN v_code || ' was replaced'
             ELSE v_code || ' is back in service' END,
        CASE WHEN v_type = 'fire_extinguisher'
             THEN 'The old unit is retired. Its replacement gets its own new code and sticker.'
             ELSE 'GSO closed the reported defect. This unit can be inspected again.' END ||
          CASE WHEN v_where <> '' THEN ' · ' || v_where ELSE '' END,
        'job_closed', NEW.id
      );
    ELSIF NEW.status = 'unresolved' THEN
      PERFORM notify_user(
        v_tech,
        'Job marked unresolved: ' || v_code,
        CASE WHEN coalesce(NEW.outcome_reason, '') <> ''
             THEN 'Reason: "' || NEW.outcome_reason || '"'
             ELSE 'GSO could not close this job yet.' END,
        'job_unresolved', NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_maintenance_action ON maintenance_actions;
CREATE TRIGGER trg_notify_maintenance_action
  AFTER INSERT OR UPDATE ON maintenance_actions
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_maintenance_action();


-- 5. Push every new notification to the recipient's phones ------------------
CREATE OR REPLACE FUNCTION public.push_notification_to_phones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_messages jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'to', t.token,
           'title', NEW.title,
           'body', coalesce(NEW.body, ''),
           'sound', 'default',
           'priority', 'high',
           'channelId', 'default',
           'data', jsonb_build_object(
             'notification_id', NEW.id,
             'kind', NEW.kind,
             'action_id', NEW.action_id
           )
         ))
    INTO v_messages
  FROM push_tokens t
  WHERE t.user_id = NEW.recipient_id;

  IF v_messages IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := v_messages,
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A push failure must never undo the inspection or job update itself.
  RAISE WARNING 'Push notification failed: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_push_notification ON notifications;
CREATE TRIGGER trg_push_notification
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION public.push_notification_to_phones();


-- 6. Only the triggers may create notifications ------------------------------
-- Without this, any signed-in user could call notify_roles() from the app
-- and send messages to everyone.
REVOKE EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_roles(text[], text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_maintenance_action() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.push_notification_to_phones() FROM PUBLIC, anon, authenticated;
