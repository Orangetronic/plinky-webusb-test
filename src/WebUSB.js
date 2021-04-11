/**
 * WebUSB port
 */
export class Port {

  constructor(device) {
    this.device = device;
    this.interfaceNumber = 0;
    this.endpointIn = 0;
    this.endpointOut = 0;
  }

  onReceive(data) {}
  onReceiveError(error) {}

  setEndpoints() {

    // Go through all the interfaces in this device configuration.
    let interfaces = this.device.configuration.interfaces;

    console.log("Interfaces", this.device.configuration.interfaces);

    interfaces.forEach(element => {
      
      console.log("Element", element);

      // Element alternates - these are the *real* elements
      // that we want to connect to.
      element.alternates.forEach(elementalt => {

      if (elementalt.interfaceClass==0xFF) {

        this.interfaceNumber = element.interfaceNumber;

        // Alternates have endpoints, that we then attach to
        // so we can communicate with the device through
        // a shared pointer.
        elementalt.endpoints.forEach(elementendpoint => {

          if (elementendpoint.direction == "out") {
            this.endpointOut = elementendpoint.endpointNumber;
          }

          if (elementendpoint.direction=="in") {
            this.endpointIn = elementendpoint.endpointNumber;
          }

        });

      }

    })});

    if(this.endpointIn === 0) { console.error('endpointIn is 0') };
    if(this.endpointOut === 0) { console.error('endpointOut is 0') };

  }

  async connect() {

    let readLoop = async () => {
      try {
        const result = await this.device.transferIn(this.endpointIn, 64)
        this.onReceive(result.data);
        readLoop();
      }
      catch(error) {
        this.onReceiveError(error);
      }
    };

    try {

      // Open the WebUSB device connection
      await this.device.open();

      // Select the passe configuration to that device
      // It is 1 as we are only interested in the first one.
      // We are only connecting to one device here.
      if (this.device.configuration === null) {
        return this.device.selectConfiguration(1);
      }

      // Set the endpoint for that device.
      await this.setEndpoints();

      console.log("Interface number:", this.interfaceNumber);
      console.log("Configuration:", this.device.configuration);

      // Claim the interface to be in use by this app.
      await this.device.claimInterface(this.interfaceNumber);

      try {
        // ??? leftover?
        //await this.device.selectAlternateInterface(this.interfaceNumber, 0);
      }
      catch(err) {
        console.error('BOO!!! this.device.selectAlternateInterface() failed');
      }

      // Send some dummy data and wait for response
      await this.device.controlTransferOut({
          'requestType': 'class',
          'recipient': 'interface',
          'request': 0x22,
          'value': 0x01,
          'index': this.interfaceNumber});

      // Start the read loop defined above
      readLoop();
      
    }
    catch(error) {

      console.error(error);

    }

  }

  async disconnect() {
    return this.device.controlTransferOut({
        'requestType': 'class',
        'recipient': 'interface',
        'request': 0x22,
        'value': 0x00,
        'index': this.interfaceNumber})
    .then(() => this.device.close());
  };

  send(data) {
    return this.device.transferOut(this.endpointOut, data);
  };

}

export class Serial {

  constructor() {
  }

  static async getPorts(constructor) {
    return navigator.usb.getDevices().then(devices => {
      return devices.map(device => constructor ? new constructor(device) : new Port(device));
    });
  };

  static async requestPort(constructor) {
    const filters = [
      { 'vendorId': 0x239A }, // Adafruit boards
      { 'vendorId': 0xcafe }, // TinyUSB example
    ];
    return navigator.usb.requestDevice({ 'filters': filters }).then(
      device => new constructor ? new constructor(device) : new Port(device)
    );
  }

}
