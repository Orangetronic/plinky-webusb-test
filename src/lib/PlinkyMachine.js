import { BankLoadMachine, PatchLoadMachine, PatchSaveMachine } from './PatchMachines';
import {
  action,
  createMachine,
  guard,
  immediate,
  interpret,
  invoke,
  reduce,
  state,
  transition,
} from 'robot3';

import { MachineStore } from './stores/MachineStore';
import { Port } from './webusb/WebUSBPort';
import { Serial } from './webusb/WebUSBSerial';
import { patch2JSON } from './plinky/patch2JSON';

/**
 * Class to wire up the WebUSB port responses to the Plinky state machine
 */
class WebUSBPlinky extends Port {

  onReceive(data) {
    console.log('Port data:', data.buffer);
    const { service } = PlinkyMachine;
    if(service.child) {
      // If we're in a child state machine state, call the child machine.
      service.child.send({
        type: 'data',
        data: data.buffer
      });
    }
    else {
      // Otherwise, call the main machine.
      service.send({
        type: 'data',
        data: data.buffer
      });
    }
  }

  onReceiveError(error) {
    console.error('Port error:', error);
    const { service } = PlinkyMachine;
    if(service.child) {
      service.child.send({
        type: 'error',
        data: error
      });
    }
    else {
      service.send({
        type: 'error',
        data: error
      });
    }

  }

}

/**
 * Connect the port inside the state machine context to a WebUSB port
 * @param {*} ctx - State machine context 
 * @returns {*} - New context with connected port
 */
export async function connect(ctx) {
  try {
    ctx.port = await Serial.requestPort(WebUSBPlinky);
    await ctx.port.connect();
    return ctx;
  }
  catch(err) {
    throw err;
  }
}

/**
 * Creates a Plinky state machine backed by a context that writes
 * to a Svelte store
 * @param {*} initialContext - Initial context to provide to machine
 * @returns {MachineStore} - Plinky state machine
 */
export function createPlinkyMachine(initialContext = {}) {

  const states = {
    disconnected: state(
      transition('connect', 'connecting'),
      transition('parsePatch', 'disconnected', reduce((ctx, ev) => {
        if(ev.patch) {
          const patch = ev.patch;
          const arrayBuffer = patch.buffer.slice(patch.byteOffset, patch.byteLength + patch.byteOffset);
          const patchJSON = patch2JSON(arrayBuffer);
          return { ...ctx, patchJSON, patch: arrayBuffer }
        }
        return { ...ctx };
      }))
    ),
    connecting: invoke(
      connect,
      transition('done', 'connected'),
      transition('error', 'error', reduce((ctx, ev) =>
        ({ ...ctx, error: ev.error })
      ))
    ),
    connected: state(
      transition('loadPatch', 'loadPatch', reduce((ctx, ev) =>
        ({ ...ctx, patchNumber: ev.patchNumber })
      )),
      transition('savePatch', 'savePatch'),
      transition('clearPatch', 'clearPatch'),
      transition('error', 'error', reduce((ctx, ev) => {
        return { ...ctx, error: ev.error };
      }))
    ),
    clearPatch: state(
      immediate('connected', reduce((ctx) => {
        ctx.patch = null;
        ctx.patchJSON = {};
        return { ...ctx }
      }))
    ),
    loadPatch: invoke(
      PatchLoadMachine,
      transition('done', 'connected', reduce((ctx, ev) => {
        const patch = Uint8Array.from(Array.prototype.concat(...ev.data.result.map(a => Array.from(a))));
        const arrayBuffer = patch.buffer.slice(patch.byteOffset, patch.byteLength + patch.byteOffset);
        const patchJSON = patch2JSON(arrayBuffer);
        return { ...ctx, patch: arrayBuffer, patchJSON };
      })),
      transition('error', 'error', reduce((ctx, ev) => {
        return { ...ctx, error: ev.error };
      }))
    ),
    savePatch: invoke(
      PatchSaveMachine,
      transition('done', 'connected'),
      transition('error', 'error', reduce((ctx, ev) => {
        return { ...ctx, error: ev.error };
      }))
    ),
    loadBank: invoke(
      BankLoadMachine,
      transition('done', 'connected', reduce((ctx, ev) => {
        const patch = Uint8Array.from(Array.prototype.concat(...ev.data.result.map(a => Array.from(a))));
        const arrayBuffer = patch.buffer.slice(patch.byteOffset, patch.byteLength + patch.byteOffset);
        const patchJSON = patch2JSON(arrayBuffer);
        return { ...ctx, patch: arrayBuffer, patchJSON };
      })),
      transition('error', 'error', reduce((ctx, ev) => {
        return { ...ctx, error: ev.error };
      }))
    ),
    error: state(
      transition('connect', 'connecting', reduce(ctx => {
        ctx.error = null;
        return { ...ctx };
      })),
    )
  };

  const context = (ctx) => {
    return { ...ctx };
  };

  const machine = createMachine(states, context);

  const bankSize = 32;
  const bank = Array(bankSize).fill().map((i, index) => {
    return {
      number: index,
      path: null
    }
  });

  return MachineStore(machine, Object.assign(initialContext, {
    port: null,
    patch: null,
    bank,
    patchJSON: {}
  }));
}

/**
 * Export a singleton of the Plinky state machine
 */
export const PlinkyMachine = createPlinkyMachine({
  patchNumber: 0,
});
