import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteUser, signOut } from 'firebase/auth';
import {
  collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc
} from 'firebase/firestore';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Baby, Copy, LocateFixed, MapPin, Plus, ShieldCheck, Smartphone, Users, Maximize2 } from 'lucide-react';
import { auth, db, ensureAuth, firebaseReady } from './firebase';
import { divIcon, icon, latLngBounds } from 'leaflet';
import { prepareProfilePhoto } from './profilePhoto';

type Role='parent'|'child';
type Profile={uid:string;name:string;photoURL?:string;role:Role;code:string;familyId?:string};
type Member={uid:string;name:string;photoURL?:string;role:Role;inviteCode?:string;active?:boolean;disconnectedAt?:{seconds:number};homeStatus?:'inside'|'outside';homeStatusUpdatedAt?:{seconds:number}};
type Location={lat:number;lng:number;accuracy:number;familyId:string;updatedAt?:{seconds:number};source?:'fast'|'precise'};
type LogoutEvent={childUid:string;name:string;photoURL?:string;familyId:string;loggedOutAt?:{seconds:number};lat?:number;lng?:number;accuracy?:number;hasLocation:boolean};
type Presence={online:boolean;lastSeen?:{seconds:number};familyId?:string};
type HomeConfig={lat:number;lng:number;radiusMeters:number;updatedAt?:{seconds:number}};
type FamilyAlert={id:string;type:'exit_home'|'logout';childUid:string;childName:string;createdAt?:{seconds:number};lat?:number;lng?:number};

const randomCode=()=>Math.random().toString(36).slice(2,6).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase();
const randomId=()=>crypto.randomUUID().replaceAll('-','').slice(0,20);

export default function App(){
  const [profile,setProfile]=useState<Profile|null>(null);
  const [loading,setLoading]=useState(true);
  const [setupRole,setSetupRole]=useState<Role|null>(null);
  const [name,setName]=useState('');
  const [photo,setPhoto]=useState<File|null>(null);
  const [joinCode,setJoinCode]=useState('');
  const [members,setMembers]=useState<Member[]>([]);
  const [selected,setSelected]=useState<Member|null>(null);
  const [locations,setLocations]=useState<Record<string,Location>>({});
  const [updating,setUpdating]=useState<Record<string,boolean>>({});
  const [fitSignal,setFitSignal]=useState(0);
  const [message,setMessage]=useState('');
  const [logoutEvents,setLogoutEvents]=useState<LogoutEvent[]>([]);
  const [presence,setPresence]=useState<Record<string,Presence>>({});
  const [home,setHome]=useState<HomeConfig|null>(null);
  const [homeRadius,setHomeRadius]=useState(150);
  const [settingHome,setSettingHome]=useState(false);
  const [alerts,setAlerts]=useState<FamilyAlert[]>([]);
  const requestStartedAt=useRef<Record<string,number>>({});
  const autoRequestedFamily=useRef<string>('');
  const children=useMemo(()=>members.filter(m=>m.role==='child' && m.active!==false),[members]);
  const parents=useMemo(()=>members.filter(m=>m.role==='parent'),[members]);

  useEffect(()=>{(async()=>{
    if(!firebaseReady){setLoading(false);return;}
    const user=await ensureAuth();
    const snap=await getDoc(doc(db,'users',user.uid));
    if(snap.exists()) setProfile({uid:user.uid,...snap.data()} as Profile);
    setLoading(false);
  })().catch(e=>{console.error(e);setLoading(false);});},[]);

  useEffect(()=>{
    if(!profile?.familyId) return;
    return onSnapshot(collection(db,'families',profile.familyId,'members'),snap=>{
      const next=snap.docs.map(d=>d.data() as Member);
      setMembers(next);
      if(selected && !next.some(m=>m.uid===selected.uid && m.active!==false)){
        setSelected(null);
      }
    });
  },[profile?.familyId]);

  useEffect(()=>{
    if(!profile?.familyId) return;
    return onSnapshot(doc(db,'families',profile.familyId),snap=>{
      const data=snap.data() as {home?:HomeConfig}|undefined;
      if(data?.home){
        setHome(data.home);
        setHomeRadius(data.home.radiusMeters||150);
      }else{
        setHome(null);
      }
    });
  },[profile?.familyId]);

  useEffect(()=>{
    if(profile?.role!=='parent' || !profile.familyId) return;
    return onSnapshot(collection(db,'families',profile.familyId,'alerts'),snap=>{
      const items=snap.docs
        .map(d=>({id:d.id,...d.data()} as FamilyAlert))
        .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
        .slice(0,10);
      setAlerts(items);
    });
  },[profile?.role,profile?.familyId]);

  useEffect(()=>{
    if(profile?.role!=='parent' || !profile.familyId) return;
    return onSnapshot(collection(db,'families',profile.familyId,'logoutEvents'),snap=>{
      const events=snap.docs
        .map(d=>d.data() as LogoutEvent)
        .sort((a,b)=>(b.loggedOutAt?.seconds||0)-(a.loggedOutAt?.seconds||0))
        .slice(0,5);
      setLogoutEvents(events);
    });
  },[profile?.role,profile?.familyId]);

  useEffect(()=>{
    if(profile?.role!=='parent' || !profile.familyId || children.length===0) return;

    Promise.allSettled(children.map(child=>
      setDoc(doc(db,'childLinks',child.uid),{
        uid:child.uid,
        familyId:profile.familyId,
        linkedBy:profile.uid,
        linkedAt:serverTimestamp()
      },{merge:true})
    )).catch(()=>{});
  },[profile?.role,profile?.familyId,children.map(c=>c.uid).join('|')]);

  useEffect(()=>{
    if(!profile || profile.role!=='child') return;

    let stopped=false;
    let timer:number|undefined;

    const publishPresence=async()=>{
      try{
        const link=await getDoc(doc(db,'childLinks',profile.uid));
        let familyId=link.exists()?String(link.data().familyId||''):'';
        if(!familyId){
          const lastRequest=await getDoc(doc(db,'locationRequests',profile.uid));
          if(lastRequest.exists()) familyId=String(lastRequest.data().familyId||'');
        }

        if(familyId){
          localStorage.setItem('familypulse.familyId',familyId);
          await setDoc(doc(db,'presence',profile.uid),{
            uid:profile.uid,
            familyId,
            online:true,
            lastSeen:serverTimestamp()
          },{merge:true});
        }
      }catch(err){
        console.warn('Presence update failed',err);
      }
    };

    publishPresence();
    timer=window.setInterval(()=>{ if(!stopped) publishPresence(); },30000);

    const onVisibility=()=>{ if(document.visibilityState==='visible') publishPresence(); };
    document.addEventListener('visibilitychange',onVisibility);

    return ()=>{
      stopped=true;
      if(timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[profile?.uid,profile?.role]);

  useEffect(()=>{
    if(!profile || profile.role!=='child') return;
    const reqRef=doc(db,'locationRequests',profile.uid);

    return onSnapshot(reqRef,async snap=>{
      const data=snap.data();
      if(!data || data.status!=='requested' || !data.familyId) return;

      const getPosition=(options:PositionOptions)=>new Promise<GeolocationPosition>((resolve,reject)=>
        navigator.geolocation.getCurrentPosition(resolve,reject,options)
      );

      try{
        let sentFast=false;

        try{
          const fast=await getPosition({enableHighAccuracy:false,timeout:1500,maximumAge:300000});
          await setDoc(doc(db,'locations',profile.uid),{
            lat:fast.coords.latitude,
            lng:fast.coords.longitude,
            accuracy:fast.coords.accuracy,
            familyId:data.familyId,
            source:'fast',
            updatedAt:serverTimestamp()
          });
          sentFast=true;
          await updateDoc(reqRef,{status:'refining',fastCompletedAt:serverTimestamp()});
          setMessage('מיקום מהיר נשלח. משפר דיוק…');
        }catch(err){
          console.warn('Fast location unavailable',err);
        }

        try{
          const precise=await getPosition({enableHighAccuracy:true,timeout:8000,maximumAge:15000});
          await setDoc(doc(db,'locations',profile.uid),{
            lat:precise.coords.latitude,
            lng:precise.coords.longitude,
            accuracy:precise.coords.accuracy,
            familyId:data.familyId,
            source:'precise',
            updatedAt:serverTimestamp()
          });
          await updateDoc(reqRef,{status:'completed',completedAt:serverTimestamp()});
          setMessage('המיקום המדויק נשלח להורה.');
        }catch(err){
          if(sentFast){
            await updateDoc(reqRef,{status:'completed',completedAt:serverTimestamp()});
            setMessage('נשלח המיקום הזמין האחרון.');
          }else{
            throw err;
          }
        }
      }catch(err){
        console.error('Location request failed',err);
        await updateDoc(reqRef,{status:'failed',completedAt:serverTimestamp()});
        setMessage('לא ניתן לקבל מיקום. יש לאשר הרשאת מיקום בדפדפן.');
      }
    });
  },[profile]);

  useEffect(()=>{
    if(!profile || profile.role!=='child') return;

    return onSnapshot(doc(db,'buzzerCommands',profile.uid),async snap=>{
      const data=snap.data() as {status?:string}|undefined;
      if(!data || data.status!=='requested') return;

      try{
        await playAlarmTone();
        await updateDoc(doc(db,'buzzerCommands',profile.uid),{
          status:'completed',
          completedAt:serverTimestamp()
        });
        setMessage('התקבלה התראת השכמה מההורה.');
      }catch(err){
        console.error('Alarm playback failed',err);
        await updateDoc(doc(db,'buzzerCommands',profile.uid),{
          status:'failed',
          completedAt:serverTimestamp()
        });
        setMessage('התקבלה התראת השכמה, אבל הדפדפן חסם את הצליל.');
      }
    });
  },[profile?.uid,profile?.role]);

  useEffect(()=>{
    if(profile?.role!=='parent' || children.length===0) return;

    const unsubs=children.map(child=>
      onSnapshot(doc(db,'presence',child.uid),snap=>{
        if(!snap.exists()) return;
        setPresence(prev=>({...prev,[child.uid]:snap.data() as Presence}));
      })
    );

    return ()=>unsubs.forEach(unsub=>unsub());
  },[profile?.role,children.map(c=>c.uid).join('|')]);

  useEffect(()=>{
    if(profile?.role!=='parent' || children.length===0) return;

    const unsubs=children.map(child=>
      onSnapshot(doc(db,'locations',child.uid),async snap=>{
        if(!snap.exists()) return;
        const next=snap.data() as Location;
        setLocations(prev=>({...prev,[child.uid]:next}));

        const started=requestStartedAt.current[child.uid]||0;
        const updatedMs=next.updatedAt?.seconds ? next.updatedAt.seconds*1000 : 0;
        if(started && updatedMs>=started-1500){
          setUpdating(prev=>({...prev,[child.uid]:false}));
        }

        if(profile?.familyId && home){
          const distance=distanceMeters(next.lat,next.lng,home.lat,home.lng);
          const newStatus:Member['homeStatus']=distance<=home.radiusMeters?'inside':'outside';

          if(child.homeStatus!==newStatus){
            await updateDoc(doc(db,'families',profile.familyId,'members',child.uid),{
              homeStatus:newStatus,
              homeStatusUpdatedAt:serverTimestamp()
            });

            if(child.homeStatus==='inside' && newStatus==='outside'){
              await setDoc(doc(db,'families',profile.familyId,'alerts',randomId()),{
                type:'exit_home',
                childUid:child.uid,
                childName:child.name,
                lat:next.lat,
                lng:next.lng,
                createdAt:serverTimestamp()
              });
            }
          }
        }
      })
    );

    return ()=>unsubs.forEach(unsub=>unsub());
  },[profile?.role,profile?.familyId,children.map(c=>`${c.uid}:${c.homeStatus||''}`).join('|'),home?.lat,home?.lng,home?.radiusMeters]);

  async function createProfile(){
    if(!setupRole || !name.trim()) return;

    setMessage('');
    setLoading(true);

    try{
      const user=await ensureAuth();

      let photoURL='';
      if(photo){
        try{
          photoURL=await prepareProfilePhoto(photo);
        }catch(err){
          console.error('Profile photo processing failed',err);
          setMessage('לא הצלחנו לעבד את התמונה. הפרופיל יישמר בלי תמונה.');
        }
      }

      const code=randomCode();
      let familyId:string|undefined;

      if(setupRole==='parent'){
        familyId=randomId();
        await setDoc(doc(db,'families',familyId),{
          createdAt:serverTimestamp(),
          ownerUid:user.uid
        });
        await setDoc(doc(db,'families',familyId,'members',user.uid),{
          uid:user.uid,
          name:name.trim(),
          photoURL,
          role:'parent'
        });
      }

      const p:Profile={
        uid:user.uid,
        name:name.trim(),
        photoURL,
        role:setupRole,
        code,
        ...(familyId ? { familyId } : {})
      };

      await setDoc(doc(db,'users',user.uid),p);
      await setDoc(doc(db,'pairCodes',code),{
        uid:user.uid,
        type:setupRole,
        familyId:familyId||null,
        name:p.name,
        photoURL:photoURL||'',
        createdAt:serverTimestamp()
      });

      setProfile(p);
    }catch(err){
      console.error('Profile creation failed',err);
      const detail=err instanceof Error ? err.message : '';
      setMessage(`שמירת הפרופיל נכשלה${detail ? `: ${detail}` : '.'}`);
    }finally{
      setLoading(false);
    }
  }

  async function connectCode(){
    if(!profile || !joinCode.trim()) return;
    const code=joinCode.trim().toUpperCase();
    const pair=await getDoc(doc(db,'pairCodes',code));
    if(!pair.exists()){setMessage('הקוד לא נמצא.');return;}
    const data=pair.data() as {uid:string;type:Role;familyId?:string;name:string;photoURL?:string};
    if(data.uid===profile.uid){setMessage('זה הקוד שלך.');return;}

    if(data.type==='child'){
      if(profile.role!=='parent' || !profile.familyId){setMessage('רק הורה יכול לצרף ילד.');return;}
      await setDoc(doc(db,'families',profile.familyId,'members',data.uid),{
        uid:data.uid,
        name:data.name,
        photoURL:data.photoURL||'',
        role:'child',
        inviteCode:code,
        active:true,
        connectedAt:serverTimestamp()
      },{merge:true});
      await setDoc(doc(db,'childLinks',data.uid),{
        uid:data.uid,
        familyId:profile.familyId,
        linkedBy:profile.uid,
        linkedAt:serverTimestamp()
      },{merge:true});
      setMessage(`${data.name} נוסף למשפחה.`);
    }else{
      if(profile.role!=='parent' || !data.familyId){setMessage('הקוד הזה אינו קוד שיתוף פעיל.');return;}
      await setDoc(doc(db,'families',data.familyId,'members',profile.uid),{
        uid:profile.uid,name:profile.name,photoURL:profile.photoURL||'',role:'parent',inviteCode:code
      });
      await updateDoc(doc(db,'users',profile.uid),{familyId:data.familyId});
      setProfile({...profile,familyId:data.familyId});
      setMessage('הצטרפת כשותף למשפחה.');
    }
    setJoinCode('');
  }

  async function getLogoutLocation(){
    const getPosition=(options:PositionOptions)=>new Promise<GeolocationPosition>((resolve,reject)=>
      navigator.geolocation.getCurrentPosition(resolve,reject,options)
    );
    try{
      return await getPosition({enableHighAccuracy:true,timeout:6000,maximumAge:30000});
    }catch{
      try{
        return await getPosition({enableHighAccuracy:false,timeout:1500,maximumAge:300000});
      }catch{
        return null;
      }
    }
  }

  async function logout(){
    if(profile?.role==='child'){
      setMessage('שומר את מצב ההתנתקות והמיקום האחרון…');

      try{
        let familyId=localStorage.getItem('familypulse.familyId')||'';

        if(!familyId){
          const link=await getDoc(doc(db,'childLinks',profile.uid));
          if(link.exists()) familyId=String(link.data().familyId||'');
        }

        if(!familyId){
          const lastRequest=await getDoc(doc(db,'locationRequests',profile.uid));
          if(lastRequest.exists()) familyId=String(lastRequest.data().familyId||'');
        }

        if(!familyId){
          throw new Error('לא ניתן לזהות את המשפחה של הילד. פתח את FamilyPulse אצל ההורה, רענן מיקום פעם אחת ונסה שוב.');
        }

        localStorage.setItem('familypulse.familyId',familyId);

        const pos=await getLogoutLocation();

        await setDoc(doc(db,'presence',profile.uid),{
          uid:profile.uid,
          familyId,
          online:false,
          lastSeen:serverTimestamp()
        },{merge:true});

        const eventData:Record<string,unknown>={
          childUid:profile.uid,
          name:profile.name,
          photoURL:profile.photoURL||'',
          familyId,
          hasLocation:Boolean(pos),
          loggedOutAt:serverTimestamp()
        };

        if(pos){
          eventData.lat=pos.coords.latitude;
          eventData.lng=pos.coords.longitude;
          eventData.accuracy=pos.coords.accuracy;
        }

        await setDoc(
          doc(db,'families',familyId,'logoutEvents',`${profile.uid}-${Date.now()}`),
          eventData
        );

        await setDoc(doc(db,'families',familyId,'alerts',randomId()),{
          type:'logout',
          childUid:profile.uid,
          childName:profile.name,
          lat:pos?.coords.latitude??null,
          lng:pos?.coords.longitude??null,
          createdAt:serverTimestamp()
        });

        await deleteDoc(doc(db,'families',familyId,'members',profile.uid));
        await deleteDoc(doc(db,'childLinks',profile.uid));
        await deleteDoc(doc(db,'presence',profile.uid));
        await deleteDoc(doc(db,'locations',profile.uid));
        await deleteDoc(doc(db,'locationRequests',profile.uid));
        await deleteDoc(doc(db,'pairCodes',profile.code));
        await deleteDoc(doc(db,'users',profile.uid));

        localStorage.removeItem('familypulse.familyId');

        if(auth.currentUser){
          await deleteUser(auth.currentUser);
        }

        window.location.reload();
        return;
      }catch(err){
        console.error('Child logout failed',err);
        const detail=err instanceof Error?err.message:'שגיאה לא ידועה';
        setMessage(`ההתנתקות נכשלה: ${detail}`);
        return;
      }
    }

    try{
      await signOut(auth);
    }finally{
      window.location.reload();
    }
  }

  async function sendBuzz(child:Member){
    if(!profile?.familyId) return;

    if(!canBuzzNow()){
      setMessage('אפשר לצפצף לילד רק בימים ראשון–חמישי בין 08:10 ל־09:00.');
      return;
    }

    if(child.homeStatus!=='inside'){
      setMessage('אפשרות הצפצוף זמינה רק לילד שמסומן כרגע בבית.');
      return;
    }

    const ok=window.confirm(`אתה בטוח שאתה רוצה לצפצף לטלפון של ${child.name}?`);
    if(!ok) return;

    await setDoc(doc(db,'buzzerCommands',child.uid),{
      childUid:child.uid,
      familyId:profile.familyId,
      requestedBy:profile.uid,
      status:'requested',
      requestedAt:serverTimestamp()
    });

    setMessage(`נשלחה בקשת צפצוף ל־${child.name}.`);
  }

  async function saveHome(lat:number,lng:number){
    if(!profile?.familyId) return;

    await setDoc(doc(db,'families',profile.familyId),{
      home:{
        lat,
        lng,
        radiusMeters:homeRadius,
        updatedAt:serverTimestamp()
      }
    },{merge:true});

    setSettingHome(false);
    setMessage('מיקום הבית נשמר.');
  }

  async function requestLocation(child:Member,focus=true){
    if(!profile?.familyId) return;
    if(focus) setSelected(child);

    requestStartedAt.current[child.uid]=Date.now();
    setUpdating(prev=>({...prev,[child.uid]:true}));

    await setDoc(doc(db,'locationRequests',child.uid),{
      childUid:child.uid,
      requestedBy:profile.uid,
      familyId:profile.familyId,
      status:'requested',
      requestedAt:serverTimestamp()
    });
  }

  useEffect(()=>{
    if(profile?.role!=='parent' || !profile.familyId || children.length===0) return;
    if(autoRequestedFamily.current===profile.familyId) return;

    autoRequestedFamily.current=profile.familyId;
    setMessage('מעדכן את המיקום של כל הילדים…');

    Promise.allSettled(children.map(child=>requestLocation(child,false)))
      .finally(()=>setMessage(''));
  },[profile?.role,profile?.familyId,children.map(c=>c.uid).join('|')]);

  if(loading) return <Center><div className="loader"/><p>טוען את FamilyPulse…</p></Center>;
  if(!firebaseReady) return <Center><Logo/><h1>FamilyPulse</h1><p>יש להגדיר את משתני Firebase לפי הקובץ <b>.env.example</b>.</p></Center>;

  if(!profile) return <div className="onboarding">
    <Logo/><h1>FamilyPulse</h1><p className="lead">המשפחה שלך, כשבאמת צריך לדעת איפה כולם.</p>
    {!setupRole?<div className="roleGrid">
      <button className="roleCard" onClick={()=>setSetupRole('parent')}><ShieldCheck/><b>אני הורה</b><span>צפייה בילדים והוספת הורה שותף</span></button>
      <button className="roleCard" onClick={()=>setSetupRole('child')}><Baby/><b>אני ילד/ה</b><span>מקבלים קוד ומאשרים מיקום לפי דרישה</span></button>
    </div>:<div className="setupCard">
      <button className="back" onClick={()=>setSetupRole(null)}>חזרה</button>
      <h2>{setupRole==='parent'?'יצירת פרופיל הורה':'יצירת פרופיל ילד/ה'}</h2>
      <label>איך קוראים לך?</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="שם פרטי"/>
      <label>תמונה</label><input type="file" accept="image/*" onChange={e=>setPhoto(e.target.files?.[0]||null)}/>
      <button className="primary" disabled={!name.trim()} onClick={createProfile}>המשך</button>
      {message&&<div className="toast">{message}</div>}
    </div>}
  </div>;

  if(profile.role==='child') return <div className="childPage">
    <TopBar profile={profile} onLogout={logout}/>
    <main className="childMain">
      <div className="pulseOrb"><MapPin/></div>
      <h1>הכול מחובר</h1>
      <p>אין צורך להשאיר GPS פעיל כל הזמן. כשהורה מבקש מיקום בזמן שהאפליקציה פתוחה, FamilyPulse מקבל נקודה עדכנית ושולח אותה.</p>
      <CodeCard code={profile.code} title="קוד החיבור שלך"/>
      <div className="infoBox"><Smartphone/><span>באייפון, אם ה־PWA סגור לגמרי, האתר לא יכול להדליק GPS ברקע. פתח/י את FamilyPulse כאשר ההורה מבקש מיקום.</span></div>
      {message&&<div className="toast">{message}</div>}
    </main>
  </div>;

  return <div className="appShell">
    <TopBar profile={profile} onLogout={logout}/>
    <main className="dashboard">
      <section className="hero"><div><span className="eyebrow">המשפחה שלי</span><h1>שלום, {profile.name}</h1><p>{children.length} ילדים · {parents.length} הורים מחוברים</p></div><div className="avatar big">{profile.photoURL?<img src={profile.photoURL}/>:profile.name[0]}</div></section>

      {logoutEvents.length>0&&<section className="logoutNotices">
        <div className="sectionTitle"><h2>התנתקויות אחרונות</h2><span>{logoutEvents.length}</span></div>
        <div className="logoutNoticeList">
          {logoutEvents.map(event=><article className="logoutNotice" key={`${event.childUid}-${event.loggedOutAt?.seconds||0}`}>
            <div className="avatar">{event.photoURL?<img src={event.photoURL}/>:event.name[0]}</div>
            <div className="grow">
              <b>{event.name} התנתק מ־FamilyPulse</b>
              <span>{event.loggedOutAt?locationAge(event.loggedOutAt):'עכשיו'}</span>
              {event.hasLocation&&typeof event.lat==='number'&&typeof event.lng==='number'
                ? <small>מיקום אחרון: {event.lat.toFixed(5)}, {event.lng.toFixed(5)}{typeof event.accuracy==='number'?` · דיוק כ־${Math.round(event.accuracy)} מ׳`:''}</small>
                : <small>לא התקבל מיקום אחרון בזמן ההתנתקות.</small>}
            </div>
          </article>)}
        </div>
      </section>}

      {alerts.length>0&&<section className="alertsPanel">
        <div className="sectionTitle"><h2>התראות</h2><span>{alerts.length}</span></div>
        <div className="alertList">
          {alerts.map(alert=><article className="familyAlert" key={alert.id}>
            <div className="grow">
              <b>{alert.type==='exit_home'?`${alert.childName} יצא מהבית`:`${alert.childName} התנתק`}</b>
              <span>{alert.createdAt?locationAge(alert.createdAt):'עכשיו'}</span>
            </div>
            {typeof alert.lat==='number'&&typeof alert.lng==='number'&&
              <button className="locate" onClick={()=>window.open(`https://www.google.com/maps?q=${alert.lat},${alert.lng}`,'_blank','noopener,noreferrer')}>
                <MapPin/> מיקום
              </button>}
          </article>)}
        </div>
      </section>}

      <section className="connectPanel">
        <div><h2><Plus/> הוספת ילד או הורה</h2><p>הקלד קוד. FamilyPulse מזהה אוטומטית אם זה ילד או הורה שותף.</p></div>
        <div className="codeInput"><input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={8} placeholder="AB12CD34"/><button onClick={connectCode}>חבר</button></div>
        {message&&<div className="toast">{message}</div>}
      </section>
      <section className="homePanel">
        <div className="homePanelHeader">
          <div>
            <h2><MapPin/> הבית</h2>
            <p>{home?'הבית מוגדר. FamilyPulse מסמן לכל ילד אם הוא בבית או מחוץ לבית.':'עדיין לא הוגדר בית.'}</p>
          </div>
          <button className={settingHome?'primary compact':'secondary compact'} onClick={()=>setSettingHome(v=>!v)}>
            <MapPin/> {settingHome?'לחץ על המפה כדי לבחור':'בחר בית על המפה'}
          </button>
        </div>
        <label className="radiusControl">
          <span>רדיוס הבית: {homeRadius} מטר</span>
          <input type="range" min="50" max="500" step="25" value={homeRadius} onChange={e=>setHomeRadius(Number(e.target.value))}/>
        </label>
      </section>

      <section><div className="sectionTitle"><h2>הילדים</h2><span>{children.length}</span></div>
        {children.length===0?<div className="empty"><Baby/><h3>עוד אין ילדים מחוברים</h3><p>פתח FamilyPulse במכשיר הילד והקלד כאן את הקוד שלו.</p></div>:
        <div className="childrenGrid">{children.map(child=>{
          const childLocation=locations[child.uid];
          return <article className={selected?.uid===child.uid?'childCard active':'childCard'} key={child.uid} onClick={()=>setSelected(child)}>
            <div className="avatar">{child.photoURL?<img src={child.photoURL}/>:child.name[0]}</div>
            <div className="grow">
              <b>{child.name}</b>
              <span>{updating[child.uid]?'מעדכן מיקום…':childLocation?locationAge(childLocation.updatedAt):'אין עדיין מיקום'}</span>
              <small className={isPresenceOnline(presence[child.uid])?'presenceOnline':'presenceOffline'}>
                {presenceText(presence[child.uid])}
              </small>
              {childLocation&&<small>דיוק כ־{Math.round(childLocation.accuracy)} מ׳ · {childLocation.source==='precise'?'מדויק':'מהיר'}</small>}
            </div>
            <div className="childActions">
              {home&&<span className={child.homeStatus==='inside'?'homeBadge inside':'homeBadge outside'}>
                {child.homeStatus==='inside'?'בבית':child.homeStatus==='outside'?'מחוץ לבית':'לא ידוע'}
              </span>}
              {canBuzzNow()&&child.homeStatus==='inside'&&
                <button className="buzzButton" onClick={e=>{e.stopPropagation();sendBuzz(child)}}>🔔 צפצף</button>}
              <button className="locate" onClick={e=>{e.stopPropagation();requestLocation(child)}}><LocateFixed/> רענן</button>
            </div>
          </article>
        })}</div>}
      </section>
      {children.length>0&&<section className="mapPanel">
        <div className="mapHeader">
          <div>
            <h2>{selected?selected.name:'כל הילדים'}</h2>
            <p>{selected&&locations[selected.uid]?`${locationAge(locations[selected.uid].updatedAt)} · דיוק כ־${Math.round(locations[selected.uid].accuracy)} מטר`:`${Object.keys(locations).length} מתוך ${children.length} מיקומים זמינים`}</p>
          </div>
          <div className="mapActions">
            <button className="secondary compact" onClick={()=>{setSelected(null);setFitSignal(v=>v+1)}}><Maximize2/> הצג את כולם</button>
            {selected&&<button className="primary compact" onClick={()=>requestLocation(selected)}><LocateFixed/> רענן מיקום</button>}
          </div>
        </div>
        {Object.keys(locations).length>0?
          <MapContainer center={[locations[Object.keys(locations)[0]].lat,locations[Object.keys(locations)[0]].lng]} zoom={13} scrollWheelZoom className="map">
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
            <MapViewport childrenList={children} locations={locations} selected={selected} fitSignal={fitSignal}/>
            <HomeClickHandler enabled={settingHome} onPick={saveHome}/>
            {home&&<Circle center={[home.lat,home.lng]} radius={home.radiusMeters} pathOptions={{fillOpacity:0.08}}/>}
            {children.map((child,index)=>{
              const loc=locations[child.uid];
              if(!loc) return null;

              const position=getDisplayPosition(child,index,children,locations);
              const markerIcon=createChildMarkerIcon(child,selected?.uid===child.uid);

              return <Marker
                key={child.uid}
                position={position}
                icon={markerIcon}
                eventHandlers={{click:()=>setSelected(child)}}
                zIndexOffset={selected?.uid===child.uid?1000:index}
              >
                <Popup>
                  <div className="mapPopup" dir="rtl">
                    <div className="mapPopupHeader">
                      <div className="avatar">{child.photoURL?<img src={child.photoURL}/>:child.name[0]}</div>
                      <div>
                        <b>{child.name}</b>
                        <small>{locationAge(loc.updatedAt)}</small>
                      </div>
                    </div>
                    <p>דיוק משוער: {Math.round(loc.accuracy)} מטר</p>
                    <button className="locate" onClick={()=>requestLocation(child)}>
                      <LocateFixed/> רענן מיקום
                    </button>
                  </div>
                </Popup>
              </Marker>
            })}
          </MapContainer>:
          <div className="mapPlaceholder"><MapPin/><span>ממתין למיקום הראשון של הילדים…</span></div>}
      </section>}
      <section className="share"><Users/><div className="grow"><h2>הורה שותף</h2><p>הורה נוסף בוחר “אני הורה” ומקליד את הקוד שלך.</p></div><CodeCard code={profile.code} compact/>
      </section>
    </main>
  </div>;
}

function Logo(){return <div className="logo"><span/><span/><span/></div>}
function Center({children}:{children:React.ReactNode}){return <div className="center">{children}</div>}
function CodeCard({code,title,compact=false}:{code:string;title?:string;compact?:boolean}){
  const copy=()=>navigator.clipboard.writeText(code);
  return <div className={compact?'codeCard compactCode':'codeCard'}>{title&&<span>{title}</span>}<strong>{code}</strong><button onClick={copy} aria-label="העתקת קוד"><Copy/></button></div>
}
function TopBar({profile,onLogout}:{profile:Profile;onLogout:()=>void}){return <header className="topbar"><div className="brand"><Logo/><b>FamilyPulse</b></div><div className="miniProfile"><span>{profile.role==='parent'?'הורה':'ילד/ה'}</span><div className="avatar tiny">{profile.photoURL?<img src={profile.photoURL}/>:profile.name[0]}</div><button className="logoutButton" onClick={onLogout}>התנתק</button></div></header>}


function locationAge(updatedAt?:{seconds:number}){
  if(!updatedAt?.seconds) return 'מיקום התקבל עכשיו';
  const diff=Math.max(0,Date.now()-updatedAt.seconds*1000);
  const seconds=Math.floor(diff/1000);
  if(seconds<10) return 'עודכן עכשיו';
  if(seconds<60) return `עודכן לפני ${seconds} שנ׳`;
  const minutes=Math.floor(seconds/60);
  if(minutes<60) return `עודכן לפני ${minutes} דק׳`;
  const hours=Math.floor(minutes/60);
  return `עודכן לפני ${hours} שע׳`;
}

function isPresenceOnline(p?:Presence){
  if(!p?.online || !p.lastSeen?.seconds) return false;
  return Date.now()-p.lastSeen.seconds*1000 < 90000;
}

function presenceText(p?:Presence){
  if(!p?.lastSeen?.seconds) return 'סטטוס חיבור לא ידוע';
  if(isPresenceOnline(p)) return 'מחובר עכשיו';
  return `לא מחובר · ${locationAge(p.lastSeen)}`;
}

function createChildMarkerIcon(child:Member,selected:boolean){
  const size=selected?38:32;

  if(child.photoURL){
    return icon({
      iconUrl:child.photoURL,
      iconSize:[size,size],
      iconAnchor:[size/2,size/2],
      popupAnchor:[0,-size/2],
      className:selected?'childImageMarker selected':'childImageMarker'
    });
  }

  return divIcon({
    className:'childPhotoMarkerHost',
    html:`<div class="childPhotoMarker${selected?' selected':''}"><span>${escapeHtml(child.name.trim().charAt(0)||'?')}</span></div>`,
    iconSize:[size,size],
    iconAnchor:[size/2,size/2],
    popupAnchor:[0,-size/2]
  });
}

function escapeHtml(value:string){
  return value
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function getDisplayPosition(
  child:Member,
  index:number,
  childrenList:Member[],
  locations:Record<string,Location>
):[number,number]{
  const loc=locations[child.uid];
  if(!loc) return [0,0];

  let collisions=0;
  for(let i=0;i<index;i++){
    const other=locations[childrenList[i]?.uid];
    if(!other) continue;
    const veryClose=Math.abs(other.lat-loc.lat)<0.000025 && Math.abs(other.lng-loc.lng)<0.000025;
    if(veryClose) collisions++;
  }

  if(collisions===0) return [loc.lat,loc.lng];

  const angle=(collisions*137.5)*Math.PI/180;
  const offset=0.000035*Math.ceil(collisions/2);
  return [
    loc.lat+Math.cos(angle)*offset,
    loc.lng+Math.sin(angle)*offset
  ];
}

function MapViewport({childrenList,locations,selected,fitSignal}:{childrenList:Member[];locations:Record<string,Location>;selected:Member|null;fitSignal:number}){
  const map=useMap();

  useEffect(()=>{
    if(selected&&locations[selected.uid]){
      const loc=locations[selected.uid];
      map.setView([loc.lat,loc.lng],16,{animate:true});
      return;
    }

    const points=childrenList
      .map(child=>locations[child.uid])
      .filter((loc):loc is Location=>Boolean(loc))
      .map(loc=>[loc.lat,loc.lng] as [number,number]);

    if(points.length===1){
      map.setView(points[0],15,{animate:true});
    }else if(points.length>1){
      map.fitBounds(latLngBounds(points),{padding:[48,48],maxZoom:15,animate:true});
    }
  },[map,selected?.uid,fitSignal,childrenList.map(c=>c.uid).join('|'),Object.values(locations).map(l=>`${l.lat},${l.lng},${l.updatedAt?.seconds||0}`).join('|')]);

  return null;
}
