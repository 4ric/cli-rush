import assert from "node:assert/strict";import test from "node:test";
import {due,intervals,schedule,score} from "../../lib/scheduler.ts";
const now=Date.parse("2026-07-10T12:00:00Z");
test("new recall schedules a ten-minute review",()=>{const r=schedule(undefined,"firstTry",now);assert.equal(r.stage,0);assert.equal(r.dueAt,now+intervals[0]);});
test("unassisted success advances intervals and caps",()=>{let r;for(let i=0;i<intervals.length;i++){r=schedule(r,"firstTry",now);assert.equal(r.stage,i);}assert.equal(schedule(r,"firstTry",now).stage,intervals.length-1);});
test("retry, reveal and failure step back without deleting best stage",()=>{const r=schedule(schedule(schedule(undefined,"firstTry",now),"firstTry",now),"firstTry",now);assert.equal(r.stage,2);for(const outcome of ["retry","revealed","failed"] as const){const l=schedule(r,outcome,now);assert.equal(l.stage,0);assert.equal(l.bestStage,2);assert.equal(l.dueAt,now+intervals[0]);}});
test("due boundary and ordering are stable",()=>{const base=schedule(undefined,"failed",now);const reviews={z:{...base,dueAt:now+1000,lapses:1},b:{...base,dueAt:now+1000,lapses:2},a:{...base,dueAt:now+1000,lapses:2}};assert.deepEqual(due(reviews,now+999),[]);assert.deepEqual(due(reviews,now+1000).map(x=>x.id),["a","b","z"]);});
test("speed and combination bonuses are capped and revealed answers score zero",()=>{assert.equal(score(1,1,0,20,false),150);assert.equal(score(3,4,0,20,true),0);});
test("retry scoring drops without advancing a combination",()=>{assert.equal(score(1,1,8000,0,false),100);assert.equal(score(1,2,8000,0,false),65);assert.equal(score(1,3,8000,0,false),30);});
