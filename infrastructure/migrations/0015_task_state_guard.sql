-- Canonical Task transitions are guarded in PostgreSQL. Dispatch remains an M3 concern.
ALTER TABLE tasks ADD COLUMN resume_status text
  CHECK (resume_status IN (
    'QUEUED', 'UNDERSTANDING', 'PLANNING', 'RUNNING', 'WAITING_APPROVAL', 'VERIFYING'
  ));

CREATE FUNCTION ayra.enforce_task_state_transition() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF NEW.status = OLD.status THEN
    IF NEW.resume_status IS DISTINCT FROM OLD.resume_status THEN
      RAISE EXCEPTION 'Task resume state cannot change independently' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('COMPLETED', 'FAILED', 'CANCELED') THEN
    RAISE EXCEPTION 'Terminal Task cannot transition' USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('PAUSED', 'BLOCKED') THEN
    IF NEW.status = OLD.resume_status OR NEW.status IN ('FAILED', 'CANCELED') THEN
      NEW.resume_status := NULL;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Interrupted Task must resume its recorded stage' USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('PAUSED', 'BLOCKED') THEN
    IF OLD.status = 'DRAFT' THEN
      RAISE EXCEPTION 'Draft Task cannot be interrupted' USING ERRCODE = '23514';
    END IF;
    NEW.resume_status := OLD.status;
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'DRAFT' THEN NEW.status IN ('QUEUED', 'CANCELED')
    WHEN 'QUEUED' THEN NEW.status IN ('UNDERSTANDING', 'FAILED', 'CANCELED')
    WHEN 'UNDERSTANDING' THEN NEW.status IN ('PLANNING', 'FAILED', 'CANCELED')
    WHEN 'PLANNING' THEN NEW.status IN ('RUNNING', 'FAILED', 'CANCELED')
    WHEN 'RUNNING' THEN NEW.status IN ('WAITING_APPROVAL', 'VERIFYING', 'FAILED', 'CANCELED')
    WHEN 'WAITING_APPROVAL' THEN NEW.status IN ('RUNNING', 'FAILED', 'CANCELED')
    WHEN 'VERIFYING' THEN NEW.status IN ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELED')
    ELSE false
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid Task state transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.resume_status IS NOT NULL THEN
    RAISE EXCEPTION 'Active Task cannot retain an interrupted stage' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tasks_state_guard BEFORE UPDATE OF status, resume_status ON tasks
  FOR EACH ROW EXECUTE FUNCTION ayra.enforce_task_state_transition();
