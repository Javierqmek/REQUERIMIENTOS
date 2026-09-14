export function normalizePageRotation(value:number){
 const rotation=((value%360)+360)%360;
 if(![0,90,180,270].includes(rotation))throw new Error("La página tiene una orientación PDF no compatible.");
 return rotation as 0|90|180|270;
}

export function fitImageInPlacement(image:{width:number;height:number},page:{x?:number;y?:number;width:number;height:number;rotation?:number},placement:{x:number;y:number;ancho:number;alto:number}){
 const rotation=normalizePageRotation(page.rotation||0);const displayWidth=rotation===90||rotation===270?page.height:page.width;const displayHeight=rotation===90||rotation===270?page.width:page.height;
 const boxWidth=placement.ancho*displayWidth;const boxHeight=placement.alto*displayHeight;
 const scale=Math.min(boxWidth/image.width,boxHeight/image.height);const width=image.width*scale;const height=image.height*scale;
 const displayX=placement.x*displayWidth+(boxWidth-width)/2;const displayTop=placement.y*displayHeight+(boxHeight-height)/2;
 const offsetX=page.x||0,offsetY=page.y||0;
 if(rotation===90)return{x:offsetX+displayTop+height,y:offsetY+displayX,width,height,rotation:90 as const};
 if(rotation===180)return{x:offsetX+page.width-displayX,y:offsetY+displayTop+height,width,height,rotation:180 as const};
 if(rotation===270)return{x:offsetX+page.width-displayTop-height,y:offsetY+page.height-displayX,width,height,rotation:270 as const};
 return{x:offsetX+displayX,y:offsetY+page.height-displayTop-height,width,height,rotation:0 as const};
}
