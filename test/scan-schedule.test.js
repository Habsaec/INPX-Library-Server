import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleForm } from '../src/services/scheduler.js';

test('daily schedule accepts its selected time', () => {
  assert.deepEqual(
    parseScheduleForm({ mode: 'daily', time_daily: '14:45', time_weekly: '03:00', full: '0' }),
    { mode: 'daily', hours: 0, time: '14:45', dow: '', full: false }
  );
});

test('weekly schedule accepts its selected time and days', () => {
  assert.deepEqual(
    parseScheduleForm({ mode: 'weekly', time_daily: '03:00', time_weekly: '22:10', dow: ['1', '5'], full: '1' }),
    { mode: 'weekly', hours: 0, time: '22:10', dow: '1,5', full: true }
  );
});

test('old form with duplicate time fields stays compatible', () => {
  assert.equal(parseScheduleForm({ mode: 'daily', time: ['09:30', '03:00'] }).mode, 'daily');
  assert.equal(parseScheduleForm({ mode: 'daily', time: ['09:30', '03:00'] }).time, '09:30');
  assert.equal(parseScheduleForm({ mode: 'weekly', time: ['03:00', '21:15'], dow: '2' }).time, '21:15');
});
