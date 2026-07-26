import { toast } from 'sonner';

/**
 * Opens `content` in a new window and triggers the browser print dialog.
 * `window.open` returning `null` (e.g. a blocked popup) doesn't throw, so a
 * plain try/catch around it silently does nothing — check the return value
 * instead so a blocked popup surfaces a visible, actionable error.
 */
export function printHtmlDocument(content: string): boolean {
  try {
    const w = window.open('', '_blank');
    if (!w) {
      toast.error('Enable pop-ups for this site to print');
      return false;
    }
    // Inject a self-contained trigger that waits for every image (e.g. the barcode) to load
    // BEFORE printing, then auto-closes. The old `w.onload = () => w.print()` was assigned AFTER
    // document.write/close, so the load event could fire first and print() never ran — the cause
    // of "sometimes nothing prints" (labels blank / no dialog). A 1.5s safety timeout prints even
    // if a load/decode event never arrives.
    const trigger = `<script>(function(){
      var fired=false;
      function go(){ if(fired) return; fired=true; try{ window.focus(); window.print(); }catch(e){} }
      window.onafterprint=function(){ setTimeout(function(){ try{ window.close(); }catch(e){} }, 150); };
      var imgs=[].slice.call(document.images||[]);
      var left=imgs.filter(function(i){ return !i.complete; }).length;
      if(!left){ setTimeout(go, 60); }
      else {
        imgs.forEach(function(i){
          if(i.complete) return;
          var f=function(){ if(--left<=0) go(); };
          i.addEventListener('load', f); i.addEventListener('error', f);
        });
      }
      setTimeout(go, 1500);
    })();<\/script>`;
    const html = content.includes('</body>') ? content.replace('</body>', trigger + '</body>') : content + trigger;
    w.document.write(html);
    w.document.close();
    return true;
  } catch {
    toast.error('Failed to open print window');
    return false;
  }
}
