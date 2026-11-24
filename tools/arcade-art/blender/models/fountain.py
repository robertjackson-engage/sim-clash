k = Kit('fountain', 29)
ST='#e6dabf'; ST2='#cfbf9c'; ST3='#b3a37e'; WA='#35c4ee'; WA2='#8fe6ff'; WH='#e9f9ff'; GOLD='#f5c021'; LIT='#ffd98a'
# ---- two low steps, a panelled basin with a moulded coping, a lit pool
k.lathe([(5.45,-0.5),(5.45,0.14),(5.1,0.14),(5.1,0.3),(4.78,0.3)],16,col=ST3,fj=0.06)
fs = k.lathe([(4.78,0.25),(4.78,0.5),(4.62,0.56),(4.62,1.0),(4.9,1.08),(4.9,1.24),(4.36,1.24),(4.36,0.5),(0,0.5)],16,col=ST,fj=0.04)
k.tint(fs, lambda c,n: ST2 if (abs(n.z) < 0.3 and 0.56 < c.z < 1.0 and int(atan2(c.y,c.x)/(2*pi)*16+16) % 2) else (ST3 if (c.z < 0.5 and n.z < 0.5) else None))
k.lathe([(4.36,1.02),(0,1.02)],16,col=WA,glow=1,fj=0.05); k.lathe([(2.2,1.03),(0,1.03)],12,col=WA2,glow=1)
for j in range(8):
    a = j*pi/4+pi/16
    k.box(0.72,0.56,1.12,(0,0,0),ST2,m=T(4.84*cos(a),4.84*sin(a),0.25)@RZ(a+pi/2),bev=0.06)
    k.box(0.86,0.7,0.12,(0,0,0),ST,m=T(4.84*cos(a),4.84*sin(a),1.37)@RZ(a+pi/2))
    if j%2: k.lathe([(0,1.49),(0.26,1.6),(0.3,1.78),(0.2,1.98),(0,2.06)],6,at=(4.84*cos(a),4.84*sin(a),0),col=GOLD)
    else:
        k.box(0.34,0.34,0.42,(4.84*cos(a),4.84*sin(a),1.49),LIT,glow=1,rz=a); k.box(0.46,0.46,0.14,(4.84*cos(a),4.84*sin(a),1.91),ST3,rz=a,top=0.3)
# ---- the pedestal with four gold spouts, two bowls, a gold finial
k.lathe([(1.35,0.5),(1.35,1.2),(1.1,1.36),(0.72,1.52),(0.6,2.3),(0.78,2.5),(0.98,2.6)],8,col=ST,cols=[ST2,ST,ST2,ST,ST2,ST],fj=0.04)
for j in range(4):
    a = j*pi/2+pi/4; ca = cos(a); sa = sin(a)
    k.box(0.34,0.5,0.34,(0,0,0),GOLD,m=T(0.85*ca,0.85*sa,1.75)@RZ(a+pi/2),bev=0.05)
    k.tube([((1.0+2.0*t)*ca,(1.0+2.0*t)*sa,1.92+0.9*t-2.3*t*t+0.5*t) for t in (0,0.3,0.6,0.85,1.0)],[0.06,0.07,0.08,0.09,0.1],col=WH,seg=4,cap=False,glow=1)
k.lathe([(0.9,2.55),(2.2,2.84),(2.95,3.06),(3.05,3.3),(2.8,3.3),(2.62,3.14),(0,3.1)],12,col=ST,cols=[ST2,ST,ST2,ST,ST,ST],smooth=True)
k.lathe([(2.72,3.24),(0,3.24)],12,col=WA2,glow=1)
k.lathe([(0.55,3.1),(0.4,3.9),(0.6,4.14),(1.5,4.4),(1.66,4.62),(1.46,4.62),(1.36,4.5),(0,4.46)],12,col=ST,cols=[ST2,ST,ST2,ST,ST,ST,ST],smooth=True)
k.lathe([(1.42,4.57),(0,4.57)],12,col=WA2,glow=1)
k.lathe([(0.3,4.46),(0.22,5.0),(0.42,5.12),(0.14,5.3)],8,col=ST2,smooth=True)
k.lathe([(0,5.22),(0.26,5.3),(0.4,5.5),(0.4,5.66),(0.26,5.86),(0,5.94)],8,col=GOLD,smooth=True)
for (a,l) in ((0,0.55),(2.1,0.42),(4.2,0.46)): k.cyl(0.07,l,(0.1*cos(a),0.1*sin(a),5.86),WH,seg=4,r2=0.01,m=RX(0.12*cos(a))@RY(0.12*sin(a)))
# ---- falling water: curtains off the bowls, jets from the rim
def curtain(r0, z0, r1, z1, n, wd):
    for j in range(n):
        a0 = 2*pi*j/n
        k.sheet(lambda u,v:((r0+(r1-r0)*v**0.6)*cos(a0+wd*(u-0.5)),(r0+(r1-r0)*v**0.6)*sin(a0+wd*(u-0.5)),z0+(z1-z0)*v**1.6),1,3,'#c6f1ff' if j%2 else WH,glow=1)
curtain(3.05,3.28,3.45,1.04,12,0.3); curtain(1.66,4.6,2.0,3.26,8,0.32)
for j in range(8):
    a = 2*pi*j/8; ca = cos(a); sa = sin(a)
    k.tube([((4.5-2.5*t)*ca,(4.5-2.5*t)*sa,1.3+4.2*t-4.0*t*t+1.75*t) for t in (0,0.25,0.5,0.75,1.0)],[0.06,0.07,0.08,0.09,0.1],col=WH,seg=4,cap=False,glow=1)
    k.box(0.22,0.22,0.22,(4.56*ca,4.56*sa,1.2),GOLD,rz=a)
R = k.done()
