-- Run ONCE in the Supabase SQL editor after deploying the app.
-- Calls the scheduler every minute: finalizes days at cutoff, plans reminders, sends pushes.
-- Replace the two placeholders first.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'rayne-fit-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- To inspect:   select * from cron.job_run_details order by start_time desc limit 20;
-- To remove:    select cron.unschedule('rayne-fit-tick');
