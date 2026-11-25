# Rules test: "Invite friends, get Pro free" (referralRewards, refSignals, referrals reward fields, referralCodes name,
# students.refProDaysBanked, settings/referralRewards). Same harness as screens-rules-test.py (Firebase Rules test API).
# Run: FB_TOKEN_FILE=<file with an OAuth token> python3 tools/tests/referral-rewards-rules-test.py functions-src/firestore.rules
import json,urllib.request,urllib.error,sys,os
T=open(os.environ['FB_TOKEN_FILE']).read().strip(); P='strykertrades-e0cd8'
D='/databases/(default)/documents'
TS="2026-11-24T00:00:00Z"
def m(fn,path,val): return {"function":fn,"args":[{"exactValue":D+path}],"result":{"value":val}}
cases=[]
def case(exp,name,uid,method,path,new=None,old=None):
    req={"auth":({"uid":uid,"token":{}} if uid else None),"method":method,"path":D+path,"time":TS}
    if new is not None: req["resource"]={"data":new}
    ms=[m("exists",f"/admins/{u}",u=='admin') for u in {uid or 'x','alice','bob','carol','admin'}]
    c={"expectation":exp,"request":req,"functionMocks":ms}
    if old is not None: c["resource"]={"data":old}
    cases.append((name,c))

RW={"referrerUid":"alice","referredUid":"bob","referralId":"r1","state":"verified","inviterDays":5,"friendDays":5,"decidedAtMillis":1}
# referralRewards: functions only
case("ALLOW","inviter reads own reward","alice","get","/referralRewards/bob",old=RW)
case("ALLOW","friend reads own reward","bob","get","/referralRewards/bob",old=RW)
case("ALLOW","admin reads reward","admin","get","/referralRewards/bob",old=RW)
case("DENY","stranger reads reward","carol","get","/referralRewards/bob",old=RW)
case("DENY","signed out reads reward",None,"get","/referralRewards/bob",old=RW)
case("DENY","inviter creates a reward","alice","create","/referralRewards/bob",new=RW)
case("DENY","friend creates own reward","bob","create","/referralRewards/bob",new=RW)
case("DENY","inviter bumps days","alice","update","/referralRewards/bob",new=dict(RW,inviterDays=365),old=RW)
case("DENY","friend flips ineligible -> verified","bob","update","/referralRewards/bob",new=dict(RW,state="verified"),old=dict(RW,state="ineligible"))
case("DENY","admin writes reward from client (function only)","admin","update","/referralRewards/bob",new=dict(RW,state="verified"),old=dict(RW,state="ineligible"))
case("DENY","delete reward","alice","delete","/referralRewards/bob",old=RW)
# refSignals: functions only
SG={"days":["2026-11-20","2026-11-21"],"ips":[],"devs":[]}
case("DENY","member writes own signals","bob","create","/refSignals/bob",new=SG)
case("DENY","member updates own signals","bob","update","/refSignals/bob",new=SG,old={"days":[]})
case("DENY","member reads own signals","bob","get","/refSignals/bob",old=SG)
case("DENY","admin reads signals from client","admin","get","/refSignals/bob",old=SG)
# referrals: the friend creates the row; reward fields never from a client
ROW={"referrerUid":"alice","referrerCode":"alice1234","referredUid":"bob","referredName":"Bob","referredEmail":"bob@x.com","status":"signed_up","signupPoints":0,"conversionPoints":0,"pointsAwarded":0,"createdAt":TS}
case("ALLOW","friend creates invite row","bob","create","/referrals/r1",new=ROW)
case("DENY","row with rewardState","bob","create","/referrals/r1",new=dict(ROW,rewardState="verified"))
case("DENY","row with rewardInviterDays","bob","create","/referrals/r1",new=dict(ROW,rewardInviterDays=90))
case("DENY","row with a back-dated createdAt","bob","create","/referrals/r1",new=dict(ROW,createdAt="2026-10-01T00:00:00Z"))
case("DENY","self-invite row","alice","create","/referrals/r1",new=dict(ROW,referredUid="alice"))
case("DENY","inviter edits row to verified","alice","update","/referrals/r1",new=dict(ROW,rewardState="verified"),old=ROW)
case("DENY","friend edits row to verified","bob","update","/referrals/r1",new=dict(ROW,rewardState="verified"),old=ROW)
case("ALLOW","inviter lists own rows","alice","get","/referrals/r1",old=ROW)
# referralCodes: public handle only
case("ALLOW","create own code with handle","alice","create","/referralCodes/alice1234",new={"uid":"alice","name":"Alice"})
case("ALLOW","create own code (no name, old client)","alice","create","/referralCodes/alice1234",new={"uid":"alice"})
case("DENY","code with an email field","alice","create","/referralCodes/alice1234",new={"uid":"alice","name":"Alice","email":"a@x.com"})
case("DENY","code name too long","alice","create","/referralCodes/alice1234",new={"uid":"alice","name":"x"*40})
case("DENY","code for someone else","bob","create","/referralCodes/alice1234",new={"uid":"alice"})
case("ALLOW","owner sets name on own code","alice","update","/referralCodes/alice1234",new={"uid":"alice","name":"@alice"},old={"uid":"alice"})
case("DENY","owner moves code to another uid","alice","update","/referralCodes/alice1234",new={"uid":"bob","name":"x"},old={"uid":"alice"})
case("DENY","stranger renames code","bob","update","/referralCodes/alice1234",new={"uid":"alice","name":"bad"},old={"uid":"alice"})
case("ALLOW","signed out resolves a code",None,"get","/referralCodes/alice1234",old={"uid":"alice","name":"Alice"})
# students: Pro fields + banked days stay server-only
ST={"plan":"Starter","email":"bob@x.com","displayName":"Bob"}
case("DENY","member grants self Pro days","bob","update","/students/bob",new=dict(ST,paidThroughMillis=9999999999999),old=ST)
case("DENY","member sets refProDaysBanked","bob","update","/students/bob",new=dict(ST,refProDaysBanked=365),old=ST)
case("DENY","member sets planSource referral + plan","bob","update","/students/bob",new=dict(ST,plan="Pro",planSource="referral"),old=ST)
case("ALLOW","member edits own display name","bob","update","/students/bob",new=dict(ST,displayName="Bobby"),old=ST)
# settings/referralRewards: readable by signed-out visitors (sign-up page wording), admin write
case("ALLOW","signed out reads reward settings",None,"get","/settings/referralRewards",old={"inviterDays":5})
case("DENY","member writes reward settings","bob","update","/settings/referralRewards",new={"inviterDays":365},old={"inviterDays":5})
case("ALLOW","admin writes reward settings","admin","update","/settings/referralRewards",new={"inviterDays":6},old={"inviterDays":5})

def run(src,label):
    body={"source":{"files":[{"name":"firestore.rules","content":src}]},"testSuite":{"testCases":[c for _,c in cases]}}
    rq=urllib.request.Request(f"https://firebaserules.googleapis.com/v1/projects/{P}:test",json.dumps(body).encode(),{"Authorization":"Bearer "+T,"Content-Type":"application/json"})
    try: r=json.load(urllib.request.urlopen(rq))
    except urllib.error.HTTPError as e: print(e.read().decode()[:3000]); return
    if r.get('issues'): print('ISSUES',json.dumps(r['issues'][:5])[:2000])
    res=r.get('testResults',[]); ok=sum(1 for x in res if x.get('state')=='SUCCESS')
    print(f"{label}: {ok}/{len(cases)} passed")
    for (n,c),x in zip(cases,res):
        if x.get('state')!='SUCCESS': print('  FAIL',n,c['expectation'],(x.get('debugMessages') or [])[:2],sorted({v.get('sourcePosition',{}).get('line') for v in x.get('visitedExpressions',[])})[:8])
run(open(sys.argv[1]).read(),sys.argv[1])
