#!/bin/sh
# Scheduled jobs. Every job is safe to run any number of times, so all of them simply run hourly:
# the daily ones do nothing once they've done that day's work.
sleep 60
while true; do
  for job in reminders daily-work expire-offers backup; do
    curl --silent --show-error --max-time 600 --output /dev/null --write-out "$job %{http_code}\n" \
      --header "Authorization: Bearer $CRON_SECRET" "http://app:3000/api/cron/$job" || echo "$job could not run"
  done
  sleep 3600
done
