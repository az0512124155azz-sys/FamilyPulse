import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc
} from 'firebase/firestore';
import { CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet';
import { Baby, Copy, LocateFixed, MapPin, Plus, ShieldCheck, Smartphone, Users, Maximize2 } from 'lucide-react';
import { auth, db, ensureAuth, firebaseReady } from './firebase';
import { latLngBounds } from 'leaflet';
import { prepareProfilePhoto } from './profilePhoto';

type Role='parent'|'child';
type Profile={uid:string;name:string;photoURL?:string;role:Role;code:string;familyId?:string};
type Member={uid:string;name:string;photoURL?:string;role:Role;inviteCode?:string};
type Location={lat:number;lng:number;accuracy:number;familyId:string;updatedAt?:{seconds:number};source?:'fast'|'precise'};

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
  const requestStartedAt=useRef<Record<string,number>>({});
  const autoRequestedFamily=useRef<string>('');

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
      if(!selected) setSelected(next.find(x=>x.role==='child')||null);
    });
  },[profile?.familyId]);

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
          const fast=await getPosition({enableHighAccuracy:false,timeout:5000,maximumAge:60000});
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
          const precise=await getPosition({enableHighAccuracy:true,timeout:15000,maximumAge:0});
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
    if(profile?.role!=='parent' || children.length===0) return;

    const unsubs=children.map(child=>
      onSnapshot(doc(db,'locations',child.uid),snap=>{
        if(!snap.exists()) return;
        const next=snap.data() as Location;
        setLocations(prev=>({...prev,[child.uid]:next}));

        const started=requestStartedAt.current[child.uid]||0;
        const updatedMs=next.updatedAt?.seconds ? next.updatedAt.seconds*1000 : 0;
        if(started && updatedMs>=started-1500){
          setUpdating(prev=>({...prev,[child.uid]:false}));
        }
      })
    );

    return ()=>unsubs.forEach(unsub=>unsub());
  },[profile?.role, children.map(c=>c.uid).join('|')]);

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
        uid:data.uid,name:data.name,photoURL:data.photoURL||'',role:'child',inviteCode:code
      });
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

  const children=useMemo(()=>members.filter(m=>m.role==='child'),[members]);
  const parents=useMemo(()=>members.filter(m=>m.role==='parent'),[members]);

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
    <TopBar profile={profile}/>
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
    <TopBar profile={profile}/>
    <main className="dashboard">
      <section className="hero"><div><span className="eyebrow">המשפחה שלי</span><h1>שלום, {profile.name}</h1><p>{children.length} ילדים · {parents.length} הורים מחוברים</p></div><div className="avatar big">{profile.photoURL?<img src={profile.photoURL}/>:profile.name[0]}</div></section>
      <section className="connectPanel">
        <div><h2><Plus/> הוספת ילד או הורה</h2><p>הקלד קוד. FamilyPulse מזהה אוטומטית אם זה ילד או הורה שותף.</p></div>
        <div className="codeInput"><input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={8} placeholder="AB12CD34"/><button onClick={connectCode}>חבר</button></div>
        {message&&<div className="toast">{message}</div>}
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
              {childLocation&&<small>דיוק כ־{Math.round(childLocation.accuracy)} מ׳ · {childLocation.source==='precise'?'מדויק':'מהיר'}</small>}
            </div>
            <button className="locate" onClick={e=>{e.stopPropagation();requestLocation(child)}}><LocateFixed/> רענן</button>
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
            {children.map(child=>{
              const loc=locations[child.uid];
              if(!loc) return null;
              return <CircleMarker key={child.uid} center={[loc.lat,loc.lng]} radius={selected?.uid===child.uid?13:10} pathOptions={{fillOpacity:0.9}} eventHandlers={{click:()=>setSelected(child)}}/>
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
function TopBar({profile}:{profile:Profile}){return <header className="topbar"><div className="brand"><Logo/><b>FamilyPulse</b></div><div className="miniProfile"><span>{profile.role==='parent'?'הורה':'ילד/ה'}</span><div className="avatar tiny">{profile.photoURL?<img src={profile.photoURL}/>:profile.name[0]}</div></div></header>}


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
