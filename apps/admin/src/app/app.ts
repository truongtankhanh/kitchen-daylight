import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Root component of the shell: the router outlet only. */
@Component({
  selector: 'kd-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
